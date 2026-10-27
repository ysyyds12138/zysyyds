"""浏览器功能验证：使用临时数据库，不修改日常演示数据。

安装 requirements-browser.txt 后运行 python scripts/browser_smoke.py。
可通过 CHROMIUM_EXECUTABLE 指定系统 Chromium，否则使用 Playwright 浏览器。
"""
import io
import json
import os
import shutil
import sys
import tempfile
import threading
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright
from werkzeug.serving import make_server

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from warehouse import create_app


def run():
    artifacts = Path(__file__).resolve().parents[1] / 'artifacts'
    artifacts.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='qinghe-browser-') as folder:
        app = create_app({'DATABASE': str(Path(folder)/'test.sqlite3'),
                          'UPLOAD_FOLDER': str(Path(folder)/'uploads'),
                          'SECRET_KEY': 'browser-test-only'})
        server = make_server('127.0.0.1', 0, app, threaded=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as p:
                executable = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
                browser = p.chromium.launch(executable_path=executable, headless=True)
                page = browser.new_page(viewport={'width':1440,'height':1050}, device_scale_factor=1,
                                        reduced_motion='reduce')
                page.set_default_timeout(10000)
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(f'http://127.0.0.1:{server.server_port}')
                page.get_by_role('heading', name='欢迎回到青禾').wait_for()
                page.screenshot(path=str(artifacts/'login.png'), full_page=True)

                def login(username, password):
                    page.locator('[name=username]').fill(username)
                    page.locator('[name=password]').fill(password)
                    page.locator('[data-form=login] [type=submit]').click()
                    page.locator('.sidebar').wait_for()

                def nav(name):
                    page.locator(f'.nav-button[data-page={name}]').click()

                def save():
                    page.locator('.modal [type=submit]').click()

                def close():
                    page.locator('.modal-head [data-action=close-modal]').click()

                login('admin', 'Admin123!')
                page.get_by_role('heading', name='让每一件好物，都井然有序。').wait_for()
                page.screenshot(path=str(artifacts/'dashboard.png'), full_page=True)
                page.set_viewport_size({'width':390,'height':844})
                page.screenshot(path=str(artifacts/'mobile.png'),full_page=True)
                page.set_viewport_size({'width':1440,'height':1050})
                # 轮播按钮与多图详情。
                track = page.locator('.showcase-track')
                page.locator('[data-action=slide-right]').click()
                page.wait_for_function("document.querySelector('.showcase-track').scrollLeft > 10")
                track.locator('.product-tile').nth(3).click()
                before = page.locator('#detail-photo').get_attribute('src')
                page.locator('[data-action=photo-next]').click()
                assert page.locator('#detail-photo').get_attribute('src') != before
                close()
                for name in ['products','inventory','locations','movements','analytics','users']:
                    nav(name)
                    assert page.locator('.page-content h1').inner_text()
                    page.screenshot(path=str(artifacts/f'{name}.png'), full_page=True)

                # 新增商品并上传真实 PNG，由服务端转换 WebP。
                nav('products')
                page.locator('[data-action=product-new]').click()
                for key, value in {'name':'浏览器测试商品','sku':'BROWSER_001','unit':'盒','price':'12.50',
                                   'length_cm':'10','width_cm':'10','height_cm':'10'}.items():
                    page.locator(f'.modal [name={key}]').fill(value)
                content=io.BytesIO()
                Image.new('RGB',(100,100),'#28775c').save(content,'PNG')
                page.locator('#photo-upload').set_input_files({'name':'photo.png','mimeType':'image/png','buffer':content.getvalue()})
                page.locator('#upload-preview img').wait_for()
                save()
                page.locator('.modal').wait_for(state='hidden')
                assert page.locator('.catalog-grid .product-tile').filter(has_text='浏览器测试商品').count()==1

                # 新建只有2L空间的位置，用于验证跨位置入库。
                nav('locations')
                page.locator('[data-action=location-new]').click()
                for key,value in {'code':'E-01-01','zone':'测试区','capacity_liters':'2'}.items():
                    page.locator(f'.modal [name={key}]').fill(value)
                save()
                page.locator('.modal').wait_for(state='hidden')
                payload=page.request.get(f'http://127.0.0.1:{server.server_port}/api/data').json()
                location_id=next(l['id'] for l in payload['locations'] if l['code']=='E-01-01')
                product_id=next(item['id'] for item in payload['products'] if item['sku']=='BROWSER_001')

                nav('inventory')
                page.locator('[data-action=inbound]').click()
                page.locator('#scan-sku').fill('BROWSER_001')
                page.locator('[data-action=lookup]').click()
                page.locator('.scan-product strong').filter(has_text='浏览器测试商品').wait_for()
                page.locator('.modal [name=batch_no]').fill('BROWSER-LOT')
                page.locator('.modal [name=quantity]').fill('5')
                page.locator('.modal [name=location_id]').select_option(str(location_id))
                save()
                page.get_by_role('heading', name='入库登记完成').wait_for()
                allocations=page.locator('.success-allocation').inner_text()
                assert 'E-01-01：2' in allocations
                assert 'A-01-01：3' in allocations
                close()
                page.locator('[data-action=outbound]').first.click()
                page.locator('#scan-sku').fill('BROWSER_001')
                page.locator('[data-action=lookup]').click()
                page.locator('.scan-product strong').filter(has_text='浏览器测试商品').wait_for()
                page.locator('.modal [name=quantity]').fill('3')
                save()
                page.get_by_role('heading', name='出库登记完成').wait_for()
                close()
                payload=page.request.get(f'http://127.0.0.1:{server.server_port}/api/data').json()
                assert next(item['quantity'] for item in payload['products'] if item['id']==product_id)==2
                assert any(m['product_id']==product_id and m['direction']=='out' and m['quantity']==3 for m in payload['movements'])
                # 超量出库会在表单中给出错误，窗口保留。
                page.locator('[data-action=outbound]').first.click()
                page.locator('#scan-sku').fill('BROWSER_001')
                page.locator('[data-action=lookup]').click()
                page.locator('.scan-product strong').filter(has_text='浏览器测试商品').wait_for()
                page.locator('.modal [name=quantity]').fill('99')
                save()
                page.locator('.form-error').filter(has_text='可用库存不足').wait_for()
                close()

                # CSV下载、分类搜索。
                with page.expect_download() as download:
                    page.locator('[data-action=export]').click()
                assert download.value.suggested_filename=='inventory.csv'
                nav('products')
                page.locator('#page-search').fill('BROWSER_001')
                page.wait_for_function("document.querySelectorAll('.catalog-grid .product-tile').length === 1")

                # 普通用户无商品编辑、账号维护权限；可登记库存。
                page.locator('[data-action=logout]').click()
                login('staff','Staff123!')
                assert page.locator('.nav-button[data-page=users]').count()==0
                nav('products')
                assert page.locator('[data-action=product-new]').count()==0
                nav('inventory')
                assert page.locator('[data-action=inbound]').count()==1

                # 移动端不溢出，菜单与入库表单可操作。
                page.set_viewport_size({'width':390,'height':844})
                page.locator('[data-action=mobile]').click()
                nav('dashboard')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                page.locator('[data-action=inbound]').click()
                page.screenshot(path=str(artifacts/'mobile-form.png'),full_page=False)
                assert page.locator('.modal [type=submit]').is_visible()
                close()
                assert not errors,errors
                print(json.dumps({'result':'passed','browser_errors':errors,'checks':[
                    '7 desktop pages','carousel and multi-photo viewer','create product and upload photo',
                    'create shelf','barcode lookup','split inbound across locations','outbound and oversell rejection',
                    'CSV download','product search','operator permissions','390px mobile layout and form'
                ]}, ensure_ascii=False, indent=2))
                browser.close()
        finally:
            server.shutdown()
            thread.join(timeout=5)


if __name__=='__main__':
    run()
