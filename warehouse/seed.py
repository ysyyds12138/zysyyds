"""只在空用户表上初始化教学数据；重复启动不会覆盖已有业务数据。"""
import json
import math
from datetime import timedelta
from werkzeug.security import generate_password_hash

from .db import get_db


def seed_demo():
    from .api import now
    db = get_db()
    if db.execute('SELECT 1 FROM users LIMIT 1').fetchone():
        return
    today = now().date()
    with db:
        db.execute('BEGIN IMMEDIATE')
        if db.execute('SELECT 1 FROM users LIMIT 1').fetchone():
            return
        db.execute('INSERT INTO users(username,display_name,password_hash,role) VALUES (?,?,?,?)',
                   ('admin', '林同学', generate_password_hash('Admin123!'), 'admin'))
        db.execute('INSERT INTO users(username,display_name,password_hash,role) VALUES (?,?,?,?)',
                   ('staff', '陈同学', generate_password_hash('Staff123!'), 'operator'))
        db.executemany('INSERT INTO user_permissions VALUES (?,?)', [(2, 'stock.write'), (2, 'locations.write')])
        db.executemany('INSERT INTO categories(name) VALUES (?)', [(n,) for n in ['饮品冲调', '休闲零食', '学习文具', '生活日用']])
        db.executemany('INSERT INTO locations(code,zone,capacity_cm3) VALUES (?,?,?)', [
            ('A-01-01', 'A区 · 饮品区', 180000), ('A-01-02', 'A区 · 饮品区', 180000),
            ('B-01-01', 'B区 · 零食区', 160000), ('B-01-02', 'B区 · 零食区', 160000),
            ('C-01-01', 'C区 · 文具区', 120000), ('D-01-01', 'D区 · 日用品区', 180000)])
        products = [
            ('6900000000001', '原味燕麦奶', 1, '盒', 7, 7, 20, 650, 25, 'oat', '谷物的轻盈，刚刚好。250mL 利乐装燕麦奶，常温避光保存。', 76, 1, 120),
            ('6900000000002', '冷萃茉莉绿茶', 1, '瓶', 6, 6, 19, 500, 30, 'tea', '清爽茶香，校园日常。500mL 无糖茉莉绿茶。', 92, 2, 180),
            ('6900000000003', '海盐苏打饼干', 2, '袋', 16, 5, 20, 890, 20, 'cracker', '课间补充一点能量。120g 独立包装，置于阴凉干燥处。', 45, 3, 12),
            ('6900000000004', '每日混合坚果', 2, '袋', 12, 3, 16, 1280, 20, 'nuts', '一小袋丰富营养。25g 混合坚果，开袋即食。', 64, 4, 90),
            ('6900000000005', '方格线圈笔记本', 3, '本', 15, 1, 21, 1590, 15, 'notebook', '把灵感，留在纸上。A5 方格内页，80张加厚纸。', 48, 5, None),
            ('6900000000006', '按动中性笔', 3, '支', 2, 2, 15, 350, 30, 'pen', '顺滑书写每一天。0.5mm 黑色笔芯，可替换。', 18, 5, None),
            ('6900000000007', '便携抽取纸巾', 4, '包', 18, 10, 10, 690, 20, 'tissue', '柔软随行，照顾每一个日常。3层100抽。', 36, 6, None),
            ('6900000000008', '草莓风味酸奶', 1, '杯', 7, 7, 9, 800, 20, 'yogurt', '酸甜的课间时刻。演示商品，请在实际仓库按商品要求配置冷藏条件。', 24, 2, 5),
        ]
        for index, item in enumerate(products, 1):
            sku, name, category, unit, length, width, height, price, reorder, art, description, quantity, location, expires = item
            db.execute('''INSERT INTO products(sku,name,category_id,unit,length_cm,width_cm,height_cm,
              price_cents,reorder_point,description,images_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
              (sku, name, category, unit, length, width, height, price, reorder, description,
               json.dumps([f'/static/images/{art}.svg', '/static/images/shelf.svg'])))
            expiry = (today + timedelta(days=expires)).isoformat() if expires is not None else None
            lot_id = db.execute('INSERT INTO lots(product_id,batch_no,production_date,expiry_date,unit_volume_cm3) VALUES (?,?,?,?,?)',
                                (index, f'B{today:%Y%m}-{index:02}', (today-timedelta(days=20)).isoformat(), expiry, math.ceil(length*width*height))).lastrowid
            stock_id = db.execute('INSERT INTO stock(lot_id,location_id,quantity) VALUES (?,?,?)', (lot_id, location, quantity)).lastrowid
            # 每条种子库存均有入库与销售流水，当前余额 = 入库 - 出库。
            sold = 4 + index * 2
            for direction, count, day, reason in [('in', quantity+sold, -(index % 6), 'purchase'), ('out', sold, -(index % 3), 'sale')]:
                stamp = now().replace(hour=9+index, minute=12, second=0, microsecond=0) + timedelta(days=day)
                movement = db.execute('''INSERT INTO movements(reference,product_id,direction,reason,
                  quantity,unit_price_cents,note,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)''',
                  (f'DEMO-{direction.upper()}-{index:03}', index, direction, reason, count, price, '初始化演示记录', 2, stamp.isoformat())).lastrowid
                db.execute('INSERT INTO movement_lines(movement_id,stock_id,quantity) VALUES (?,?,?)', (movement, stock_id, count))
        # 同一个商品的另一批次，用于演示批次区分与先到期先出。
        lot_id = db.execute('INSERT INTO lots(product_id,batch_no,production_date,expiry_date,unit_volume_cm3) VALUES (?,?,?,?,?)',
                            (1, 'B-NEAR-EXPIRY', (today-timedelta(days=80)).isoformat(), (today+timedelta(days=8)).isoformat(), 980)).lastrowid
        stock_id = db.execute('INSERT INTO stock(lot_id,location_id,quantity) VALUES (?,?,?)', (lot_id, 1, 16)).lastrowid
        movement = db.execute('''INSERT INTO movements(reference,product_id,direction,reason,quantity,
          unit_price_cents,note,actor_id,created_at) VALUES ('DEMO-IN-NEAR',1,'in','purchase',16,650,'临期预警演示',2,?)''', (now().isoformat(timespec='seconds'),)).lastrowid
        db.execute('INSERT INTO movement_lines(movement_id,stock_id,quantity) VALUES (?,?,16)', (movement, stock_id))
