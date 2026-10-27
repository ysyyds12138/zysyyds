import csv
import io
import json
import math
import re
import secrets
import sqlite3
import uuid
import warnings
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from functools import wraps
from pathlib import Path
from zoneinfo import ZoneInfo

from flask import (Blueprint, abort, current_app, g, jsonify, render_template,
                   request, send_from_directory, session, Response)
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.security import check_password_hash, generate_password_hash

from .db import get_db

bp = Blueprint('warehouse', __name__)
PERMISSIONS = {'stock.write', 'locations.write'}


def now():
    return datetime.now(ZoneInfo('Asia/Shanghai'))


def fail(message, code=400):
    abort(code, description=message)


def payload():
    value = request.get_json(silent=True)
    if not isinstance(value, dict):
        fail('请提交有效的 JSON 对象')
    return value


def text_field(data, key, label, maximum=100, required=True):
    value = data.get(key, '')
    if not isinstance(value, str):
        fail(f'{label}格式不正确')
    value = value.strip()
    if (required and not value) or len(value) > maximum:
        fail(f'{label}不能为空且不得超过 {maximum} 字')
    return value


def integer(value, label, minimum=0, maximum=1000000):
    if isinstance(value, bool) or len(str(value)) > 12 or not re.fullmatch(r'[0-9]+', str(value)):
        fail(f'{label}必须为整数')
    number = int(value)
    if not minimum <= number <= maximum:
        fail(f'{label}须在 {minimum} 至 {maximum} 之间')
    return number


def decimal_number(value, label, minimum=Decimal('0'), maximum=Decimal('1000000')):
    try:
        number = Decimal(str(value))
        if not number.is_finite() or not minimum <= number <= maximum:
            raise ValueError
        return number
    except (InvalidOperation, ValueError):
        fail(f'{label}须在 {minimum} 至 {maximum} 之间')


def date_field(data, key, label, optional=False):
    raw = data.get(key)
    if optional and not raw:
        return None
    try:
        if not isinstance(raw, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw):
            raise ValueError
        return date.fromisoformat(raw).isoformat()
    except (ValueError, TypeError):
        fail(f'{label}不是有效日期')


def user_dict(row):
    permissions = sorted(PERMISSIONS) if row['role'] == 'admin' else [
        r['permission'] for r in get_db().execute(
            'SELECT permission FROM user_permissions WHERE user_id=? ORDER BY permission', (row['id'],))]
    return dict(id=row['id'], username=row['username'], display_name=row['display_name'],
                role=row['role'], active=bool(row['active']), permissions=permissions)


@bp.before_app_request
def authentication():
    if not request.path.startswith('/api/'):
        return
    session.setdefault('csrf', secrets.token_hex(32))
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        supplied = request.headers.get('X-CSRF-Token', '')
        if not secrets.compare_digest(supplied, session['csrf']):
            fail('会话校验失败，请刷新页面后重试', 403)
    g.user = get_db().execute('SELECT * FROM users WHERE id=? AND active=1',
                              (session.get('user_id'),)).fetchone()
    if request.path not in ('/api/session', '/api/login', '/api/health') and not g.user:
        fail('请先登录', 401)


def require(permission=None, admin=False):
    def decorator(fn):
        @wraps(fn)
        def guarded(*args, **kwargs):
            if not g.user:
                fail('请先登录', 401)
            if admin and g.user['role'] != 'admin':
                fail('此操作仅限管理员', 403)
            if permission and g.user['role'] != 'admin':
                found = get_db().execute('SELECT 1 FROM user_permissions WHERE user_id=? AND permission=?',
                                         (g.user['id'], permission)).fetchone()
                if not found:
                    fail('当前账号未获得此操作权限，请联系管理员', 403)
            return fn(*args, **kwargs)
        return guarded
    return decorator


@bp.get('/')
def index():
    return render_template('index.html')


@bp.get('/api/health')
def health():
    get_db().execute('SELECT 1').fetchone()
    return jsonify(status='ok')


@bp.get('/api/session')
def get_session():
    return jsonify(user=user_dict(g.user) if g.user else None, csrf=session['csrf'])


@bp.post('/api/login')
def login():
    data = payload()
    username = text_field(data, 'username', '用户名', 40)
    password = text_field(data, 'password', '密码', 128)
    row = get_db().execute('SELECT * FROM users WHERE username=? AND active=1', (username,)).fetchone()
    if not row or not check_password_hash(row['password_hash'], password):
        fail('用户名或密码错误，或账号已停用', 401)
    session.clear()
    session.update(user_id=row['id'], csrf=secrets.token_hex(32))
    session.permanent = True
    return jsonify(user=user_dict(row), csrf=session['csrf'])


@bp.post('/api/logout')
def logout():
    session.clear()
    session['csrf'] = secrets.token_hex(32)
    return jsonify(csrf=session['csrf'])


@bp.post('/api/password')
def password():
    data = payload()
    old = text_field(data, 'old_password', '原密码', 128)
    new = text_field(data, 'new_password', '新密码', 128)
    if not check_password_hash(g.user['password_hash'], old):
        fail('原密码不正确')
    if len(new) < 8:
        fail('新密码至少 8 位')
    db = get_db()
    db.execute('UPDATE users SET password_hash=? WHERE id=?', (generate_password_hash(new), g.user['id']))
    db.commit()
    return jsonify(message='密码已修改')


def product_rows():
    rows = get_db().execute('''SELECT p.*,c.name category,
      COALESCE((SELECT SUM(s.quantity) FROM stock s JOIN lots l ON l.id=s.lot_id
      WHERE l.product_id=p.id),0) quantity FROM products p
      JOIN categories c ON c.id=p.category_id ORDER BY p.active DESC,p.id''').fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item['images'] = json.loads(item.pop('images_json'))
        result.append(item)
    return result


def stock_rows():
    return [dict(r) for r in get_db().execute('''SELECT s.id,s.quantity,s.location_id,
      l.id lot_id,l.product_id,l.batch_no,l.production_date,l.expiry_date,l.unit_volume_cm3,
      p.sku,p.name,p.unit,p.price_cents,c.name category,loc.code location,loc.zone,
      CASE WHEN l.expiry_date IS NULL THEN NULL ELSE CAST(julianday(l.expiry_date)-julianday(?) AS INTEGER) END days_left
      FROM stock s JOIN lots l ON l.id=s.lot_id JOIN products p ON p.id=l.product_id
      JOIN categories c ON c.id=p.category_id JOIN locations loc ON loc.id=s.location_id
      WHERE s.quantity>0 ORDER BY l.expiry_date IS NULL,l.expiry_date,p.name,loc.code''',
      (now().date().isoformat(),))]


def location_rows():
    return [dict(r) for r in get_db().execute('''SELECT loc.*,
      COALESCE(SUM(s.quantity*l.unit_volume_cm3),0) used_cm3,
      COALESCE(SUM(s.quantity),0) quantity FROM locations loc
      LEFT JOIN stock s ON s.location_id=loc.id LEFT JOIN lots l ON l.id=s.lot_id
      GROUP BY loc.id ORDER BY loc.code''')]


@bp.get('/api/data')
def all_data():
    db = get_db()
    movements = [dict(r) for r in db.execute('''SELECT m.*,p.name,p.sku,p.unit,u.display_name actor,
      (SELECT GROUP_CONCAT(l.batch_no||' · '||loc.code||' ×'||ml.quantity,' / ')
       FROM movement_lines ml JOIN stock s ON s.id=ml.stock_id JOIN lots l ON l.id=s.lot_id
       JOIN locations loc ON loc.id=s.location_id WHERE ml.movement_id=m.id) allocation
      FROM movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.actor_id
      ORDER BY m.created_at DESC,m.id DESC''')]
    return jsonify(products=product_rows(), stock=stock_rows(), locations=location_rows(),
                   lots=[dict(r) for r in db.execute('SELECT * FROM lots ORDER BY id DESC')],
                   categories=[dict(r) for r in db.execute('SELECT * FROM categories ORDER BY id')],
                   movements=movements, today=now().date().isoformat(),
                   users=[user_dict(r) for r in db.execute('SELECT * FROM users ORDER BY id')]
                   if g.user['role'] == 'admin' else [])


@bp.get('/api/products/lookup')
def lookup():
    sku = request.args.get('sku', '').strip()
    product = next((p for p in product_rows() if p['sku'] == sku and p['active']), None)
    if not product:
        fail('未找到此编码对应的在用商品', 404)
    return jsonify(product=product, stock=[s for s in stock_rows() if s['product_id'] == product['id']])


@bp.post('/api/categories')
@require(admin=True)
def create_category():
    name = text_field(payload(), 'name', '分类名称', 30)
    db = get_db()
    try:
        with db:
            cursor = db.execute('INSERT INTO categories(name) VALUES (?)', (name,))
    except sqlite3.IntegrityError:
        fail('该分类已存在')
    return jsonify(id=cursor.lastrowid, message='分类已添加'), 201


@bp.route('/api/products', methods=['POST'])
@bp.route('/api/products/<int:item_id>', methods=['PUT'])
@require(admin=True)
def save_product(item_id=None):
    data = payload()
    name = text_field(data, 'name', '商品名称', 80)
    sku = text_field(data, 'sku', '商品编码', 40)
    if not re.fullmatch(r'[A-Za-z0-9_-]+', sku):
        fail('商品编码仅支持字母、数字、下划线和短横线')
    unit = text_field(data, 'unit', '计量单位', 10)
    description = text_field(data, 'description', '商品介绍', 1000, False)
    category = integer(data.get('category_id'), '分类', 1)
    sizes = [float(decimal_number(data.get(k), '包装尺寸', Decimal('0.1'), Decimal('1000')))
             for k in ('length_cm', 'width_cm', 'height_cm')]
    price = int((decimal_number(data.get('price'), '售价') * 100).quantize(Decimal('1')))
    reorder = integer(data.get('reorder_point', 20), '预警库存')
    images = data.get('images', [])
    if not isinstance(images, list) or len(images) > 8 or any(
        not isinstance(image, str) or not re.fullmatch(r'/(?:static/images/[a-zA-Z0-9_-]+\.svg|uploads/[a-f0-9]{32}\.webp)', image)
        for image in images):
        fail('图片仅支持系统示例图片和已上传的商品照片，最多 8 张')
    db = get_db()
    if not db.execute('SELECT 1 FROM categories WHERE id=?', (category,)).fetchone():
        fail('分类不存在')
    if item_id and not db.execute('SELECT 1 FROM products WHERE id=?', (item_id,)).fetchone():
        fail('商品不存在', 404)
    values = (sku, name, category, unit, *sizes, price, reorder, description, json.dumps(images))
    try:
        with db:
            if item_id:
                db.execute('''UPDATE products SET sku=?,name=?,category_id=?,unit=?,length_cm=?,
                  width_cm=?,height_cm=?,price_cents=?,reorder_point=?,description=?,images_json=? WHERE id=?''', (*values, item_id))
            else:
                cursor = db.execute('''INSERT INTO products(sku,name,category_id,unit,length_cm,
                  width_cm,height_cm,price_cents,reorder_point,description,images_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)''', values)
                item_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        fail('商品编码已存在')
    return jsonify(id=item_id, message='商品资料已保存')


@bp.post('/api/products/<int:item_id>/archive')
@require(admin=True)
def archive_product(item_id):
    db = get_db()
    with db:
        db.execute('BEGIN IMMEDIATE')
        product = db.execute('SELECT * FROM products WHERE id=?', (item_id,)).fetchone()
        if not product:
            fail('商品不存在', 404)
        quantity = db.execute('''SELECT COALESCE(SUM(s.quantity),0) FROM stock s
          JOIN lots l ON l.id=s.lot_id WHERE l.product_id=?''', (item_id,)).fetchone()[0]
        if product['active'] and quantity:
            fail('商品仍有库存，请先完成出库后再停用')
        db.execute('UPDATE products SET active=? WHERE id=?', (int(not product['active']), item_id))
    return jsonify(message='商品状态已更新')


@bp.post('/api/uploads')
@require(admin=True)
def upload():
    file = request.files.get('file')
    if not file:
        fail('请选择商品图片')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(file.stream) as source:
                if source.format not in ('JPEG', 'PNG', 'WEBP'):
                    fail('仅支持 JPG、PNG、WebP 图片')
                image = ImageOps.exif_transpose(source)
                image.thumbnail((1600, 1600))
                image = image.convert('RGB')
                filename = uuid.uuid4().hex + '.webp'
                image.save(Path(current_app.config['UPLOAD_FOLDER']) / filename, 'WEBP', quality=85)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        fail('图片无法读取或尺寸过大')
    return jsonify(url='/uploads/' + filename), 201


@bp.get('/uploads/<path:filename>')
def uploaded_file(filename):
    if not get_db().execute('SELECT 1 FROM users WHERE id=? AND active=1', (session.get('user_id'),)).fetchone():
        fail('请先登录', 401)
    return send_from_directory(current_app.config['UPLOAD_FOLDER'], filename)


@bp.route('/api/locations', methods=['POST'])
@bp.route('/api/locations/<int:item_id>', methods=['PUT'])
@require('locations.write')
def save_location(item_id=None):
    data = payload()
    code = text_field(data, 'code', '位置编号', 30)
    zone = text_field(data, 'zone', '所属区域', 30)
    capacity = int(decimal_number(data.get('capacity_liters'), '容积（升）', Decimal('0.001')) * 1000)
    db = get_db()
    try:
        with db:
            db.execute('BEGIN IMMEDIATE')
            if item_id:
                existing = next((r for r in location_rows() if r['id'] == item_id), None)
                if not existing:
                    fail('位置不存在', 404)
                if capacity < existing['used_cm3']:
                    fail('新容积不能小于当前已使用空间')
                db.execute('UPDATE locations SET code=?,zone=?,capacity_cm3=? WHERE id=?', (code, zone, capacity, item_id))
            else:
                cursor = db.execute('INSERT INTO locations(code,zone,capacity_cm3) VALUES (?,?,?)', (code, zone, capacity))
                item_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        fail('位置编号已存在')
    return jsonify(id=item_id, message='仓储位置已保存')


@bp.post('/api/locations/<int:item_id>/archive')
@require('locations.write')
def archive_location(item_id):
    db = get_db()
    with db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT * FROM locations WHERE id=?', (item_id,)).fetchone()
        if not row:
            fail('位置不存在', 404)
        if row['active'] and db.execute('SELECT COALESCE(SUM(quantity),0) FROM stock WHERE location_id=?', (item_id,)).fetchone()[0]:
            fail('位置仍有库存，无法停用')
        db.execute('UPDATE locations SET active=? WHERE id=?', (int(not row['active']), item_id))
    return jsonify(message='位置状态已更新')


@bp.post('/api/movements')
@require('stock.write')
def move_stock():
    data = payload()
    product_id = integer(data.get('product_id'), '商品', 1)
    quantity = integer(data.get('quantity'), '数量', 1)
    direction = data.get('direction')
    reason = data.get('reason')
    if direction not in ('in', 'out'):
        fail('请选择入库或出库')
    if reason not in ({'purchase', 'return'} if direction == 'in' else {'sale', 'consume', 'damage'}):
        fail('请选择有效的出入库类型')
    note = text_field(data, 'note', '备注', 300, False)
    db = get_db()
    allocations = []
    # SQLite 写锁覆盖库存读取、容量校验、分配、流水，保证失败时整笔回滚。
    with db:
        db.execute('BEGIN IMMEDIATE')
        product = db.execute('SELECT * FROM products WHERE id=? AND active=1', (product_id,)).fetchone()
        if not product:
            fail('商品不存在或已停用')
        if direction == 'in':
            batch_no = text_field(data, 'batch_no', '批次号', 50)
            production = date_field(data, 'production_date', '生产日期')
            expiry = date_field(data, 'expiry_date', '到期日期', True)
            if production > now().date().isoformat():
                fail('生产日期不能晚于今天')
            if expiry and (expiry < production or expiry < now().date().isoformat()):
                fail('到期日期不能早于生产日期或今天')
            location_id = integer(data.get('location_id'), '首选位置', 1)
            locations = [r for r in location_rows() if r['active']]
            if location_id not in [r['id'] for r in locations]:
                fail('首选位置不存在或已停用')
            lot = db.execute('SELECT * FROM lots WHERE product_id=? AND batch_no=?', (product_id, batch_no)).fetchone()
            default_volume = math.ceil(product['length_cm'] * product['width_cm'] * product['height_cm'])
            volume = integer(data.get('unit_volume_cm3', lot['unit_volume_cm3'] if lot else default_volume), '单件占用体积（cm³）', 1, 1000000000)
            if lot:
                if (lot['production_date'], lot['expiry_date'], lot['unit_volume_cm3']) != (production, expiry, volume):
                    fail('同一批次的生产日期、到期日期和包装体积必须一致，请核对或使用新批次号')
                lot_id = lot['id']
            else:
                lot_id = db.execute('''INSERT INTO lots(product_id,batch_no,production_date,expiry_date,
                  unit_volume_cm3) VALUES (?,?,?,?,?)''', (product_id, batch_no, production, expiry, volume)).lastrowid
            automatic = data.get('auto_allocate', True)
            if not isinstance(automatic, bool):
                fail('自动分配参数格式不正确')
            locations.sort(key=lambda r: (r['id'] != location_id, r['code']))
            remaining = quantity
            for location in locations:
                if not automatic and location['id'] != location_id:
                    continue
                count = min(remaining, (location['capacity_cm3'] - location['used_cm3']) // volume)
                if count <= 0:
                    continue
                db.execute('''INSERT INTO stock(lot_id,location_id,quantity) VALUES (?,?,?)
                  ON CONFLICT(lot_id,location_id) DO UPDATE SET quantity=quantity+excluded.quantity''', (lot_id, location['id'], count))
                stock_id = db.execute('SELECT id FROM stock WHERE lot_id=? AND location_id=?', (lot_id, location['id'])).fetchone()[0]
                allocations.append(dict(stock_id=stock_id, location=location['code'], quantity=count, batch_no=batch_no))
                remaining -= count
                if not remaining:
                    break
            if remaining:
                fail(f'可用空间不足，仍有 {remaining} {product["unit"]} 无法存放；本次入库未生效')
        else:
            stock_id = data.get('stock_id')
            parameters = [product_id]
            sql = '''SELECT s.*,l.batch_no,l.expiry_date,loc.code FROM stock s JOIN lots l ON l.id=s.lot_id
              JOIN locations loc ON loc.id=s.location_id WHERE l.product_id=? AND s.quantity>0'''
            if stock_id:
                sql += ' AND s.id=?'
                parameters.append(integer(stock_id, '库存批次', 1))
            if reason != 'damage':
                sql += ' AND (l.expiry_date IS NULL OR l.expiry_date>=?)'
                parameters.append(now().date().isoformat())
            sql += ' ORDER BY l.expiry_date IS NULL,l.expiry_date,l.production_date,s.id'
            candidates = db.execute(sql, parameters).fetchall()
            if sum(s['quantity'] for s in candidates) < quantity:
                fail('可用库存不足；过期商品仅允许报损出库，本次操作未生效')
            remaining = quantity
            for stock in candidates:
                count = min(remaining, stock['quantity'])
                db.execute('UPDATE stock SET quantity=quantity-? WHERE id=?', (count, stock['id']))
                allocations.append(dict(stock_id=stock['id'], location=stock['code'], quantity=count, batch_no=stock['batch_no']))
                remaining -= count
                if not remaining:
                    break
        reference = ('IN' if direction == 'in' else 'OUT') + now().strftime('%Y%m%d') + uuid.uuid4().hex[:10].upper()
        movement_id = db.execute('''INSERT INTO movements(reference,product_id,direction,reason,quantity,
          unit_price_cents,note,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)''',
          (reference, product_id, direction, reason, quantity, product['price_cents'], note, g.user['id'], now().isoformat(timespec='seconds'))).lastrowid
        db.executemany('INSERT INTO movement_lines(movement_id,stock_id,quantity) VALUES (?,?,?)',
                       [(movement_id, a['stock_id'], a['quantity']) for a in allocations])
    return jsonify(message='入库成功' if direction == 'in' else '出库成功', reference=reference, allocations=allocations), 201


@bp.route('/api/users', methods=['POST'])
@bp.route('/api/users/<int:item_id>', methods=['PUT'])
@require(admin=True)
def save_user(item_id=None):
    data = payload()
    username = text_field(data, 'username', '用户名', 30)
    if not re.fullmatch(r'[A-Za-z0-9_]{3,30}', username):
        fail('用户名须为 3—30 位字母、数字或下划线')
    display = text_field(data, 'display_name', '姓名', 30)
    role = data.get('role')
    if role not in ('admin', 'operator'):
        fail('请选择有效角色')
    active = data.get('active', True)
    if not isinstance(active, bool):
        fail('账号状态格式不正确')
    permissions = data.get('permissions', [])
    if not isinstance(permissions, list) or any(not isinstance(p, str) or p not in PERMISSIONS for p in permissions):
        fail('权限配置不正确')
    password = text_field(data, 'password', '密码', 128, False)
    if (not item_id or password) and len(password) < 8:
        fail('密码至少 8 位')
    db = get_db()
    try:
        with db:
            db.execute('BEGIN IMMEDIATE')
            if item_id:
                existing = db.execute('SELECT * FROM users WHERE id=?', (item_id,)).fetchone()
                if not existing:
                    fail('用户不存在', 404)
                if item_id == g.user['id'] and (not active or role != 'admin'):
                    fail('不能停用当前管理员账号或移除自己的管理员身份')
                db.execute('UPDATE users SET username=?,display_name=?,role=?,active=? WHERE id=?', (username, display, role, int(active), item_id))
                if password:
                    db.execute('UPDATE users SET password_hash=? WHERE id=?', (generate_password_hash(password), item_id))
            else:
                item_id = db.execute('INSERT INTO users(username,display_name,password_hash,role,active) VALUES (?,?,?,?,?)',
                                     (username, display, generate_password_hash(password), role, int(active))).lastrowid
            db.execute('DELETE FROM user_permissions WHERE user_id=?', (item_id,))
            db.executemany('INSERT INTO user_permissions(user_id,permission) VALUES (?,?)', [(item_id, p) for p in set(permissions)])
    except sqlite3.IntegrityError:
        fail('用户名已存在')
    return jsonify(id=item_id, message='账号及权限已保存')


@bp.get('/api/export/inventory.csv')
def export_inventory():
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['商品编码', '商品名称', '分类', '批次', '位置', '数量', '单位', '生产日期', '到期日期', '剩余天数'])
    def safe(value):
        result = '' if value is None else str(value)
        return "'" + result if result.startswith(('=', '+', '-', '@', '\t', '\r')) else result
    for row in stock_rows():
        writer.writerow([safe(row[key]) for key in ('sku', 'name', 'category', 'batch_no', 'location', 'quantity', 'unit', 'production_date', 'expiry_date', 'days_left')])
    return Response('\ufeff' + output.getvalue(), mimetype='text/csv',
                    headers={'Content-Disposition': 'attachment; filename=inventory.csv'})
