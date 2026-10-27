import io
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from PIL import Image

from conftest import login
from warehouse.api import now
from warehouse.db import get_db
from warehouse.seed import seed_demo


def inbound(**updates):
    today = now().date()
    data = dict(product_id=1, direction='in', reason='purchase', quantity=10,
                batch_no='TEST-LOT', production_date=today.isoformat(),
                expiry_date=(today+timedelta(days=90)).isoformat(),
                unit_volume_cm3=1000, location_id=1, auto_allocate=True)
    return {**data, **updates}


def outbound(**updates):
    return dict(product_id=1, direction='out', reason='sale', quantity=5, **updates)


def test_authentication_csrf_and_private_data(client):
    assert client.get('/api/health').json['status'] == 'ok'
    assert client.get('/api/data').status_code == 401
    assert client.post('/api/login', json={}).status_code == 403
    token = client.get('/api/session').json['csrf']
    bad = client.post('/api/login', json={'username': 'admin', 'password': 'wrong'}, headers={'X-CSRF-Token': token})
    assert bad.status_code == 401
    headers = login(client)
    data = client.get('/api/data').json
    assert len(data['products']) == 8
    assert all('password_hash' not in user for user in data['users'])
    assert client.post('/api/logout', headers=headers).status_code == 200
    assert client.get('/api/data').status_code == 401


def test_seed_is_repeatable_and_balances_match(app, client, admin):
    with app.app_context():
        db = get_db()
        count = db.execute('SELECT COUNT(*) FROM movements').fetchone()[0]
        seed_demo()
        assert db.execute('SELECT COUNT(*) FROM movements').fetchone()[0] == count
        for row in db.execute('SELECT id,quantity FROM stock'):
            balance = db.execute('''SELECT SUM(CASE WHEN m.direction='in' THEN ml.quantity ELSE -ml.quantity END)
                FROM movement_lines ml JOIN movements m ON m.id=ml.movement_id WHERE stock_id=?''', (row['id'],)).fetchone()[0]
            assert balance == row['quantity']


def test_operator_permission_and_immediate_revocation(app, client):
    headers = login(client, 'staff', 'Staff123!')
    assert client.post('/api/products', json={}, headers=headers).status_code == 403
    assert client.post('/api/users', json={}, headers=headers).status_code == 403
    assert client.get('/api/data').json['users'] == []
    with app.app_context():
        db = get_db()
        with db:
            db.execute('DELETE FROM user_permissions WHERE user_id=2')
    assert client.post('/api/movements', json=inbound(), headers=headers).status_code == 403
    with app.app_context():
        db = get_db()
        with db:
            db.execute('UPDATE users SET active=0 WHERE id=2')
    assert client.get('/api/data').status_code == 401


def test_inbound_splits_across_shelves_and_creates_audit(app, client, admin):
    with app.app_context():
        db = get_db()
        with db:
            used = db.execute('SELECT SUM(s.quantity*l.unit_volume_cm3) FROM stock s JOIN lots l ON l.id=s.lot_id WHERE location_id=1').fetchone()[0]
            db.execute('UPDATE locations SET capacity_cm3=? WHERE id=1', (used+2000,))
    result = client.post('/api/movements', json=inbound(), headers=admin)
    assert result.status_code == 201
    assert result.json['allocations'][0]['quantity'] == 2
    assert result.json['allocations'][0]['location'] == 'A-01-01'
    assert sum(a['quantity'] for a in result.json['allocations']) == 10
    with app.app_context():
        db = get_db()
        assert db.execute("SELECT COUNT(*) FROM lots WHERE batch_no='TEST-LOT'").fetchone()[0] == 1
        movement = db.execute('SELECT * FROM movements WHERE reference=?', (result.json['reference'],)).fetchone()
        assert movement['actor_id'] == 1 and movement['quantity'] == 10
        assert db.execute('SELECT SUM(quantity) FROM movement_lines WHERE movement_id=?', (movement['id'],)).fetchone()[0] == 10


def test_capacity_failure_rolls_back_lot_stock_and_movement(app, client, admin):
    before = client.get('/api/data').json
    response = client.post('/api/movements', json=inbound(quantity=1000, auto_allocate=False), headers=admin)
    assert response.status_code == 400
    after = client.get('/api/data').json
    assert after['stock'] == before['stock']
    assert after['movements'] == before['movements']
    with app.app_context():
        assert not get_db().execute("SELECT 1 FROM lots WHERE batch_no='TEST-LOT'").fetchone()


def test_outbound_uses_nearest_expiry_and_rejects_oversell(client, admin):
    response = client.post('/api/movements', json=outbound(), headers=admin)
    assert response.status_code == 201
    assert response.json['allocations'][0]['batch_no'] == 'B-NEAR-EXPIRY'
    before = client.get('/api/data').json
    data = outbound()
    data['quantity'] = 100000
    assert client.post('/api/movements', json=data, headers=admin).status_code == 400
    assert client.get('/api/data').json['stock'] == before['stock']
    assert client.get('/api/data').json['movements'] == before['movements']


def test_expired_goods_only_allow_damage(app, client, admin):
    with app.app_context():
        db = get_db()
        with db:
            db.execute("UPDATE lots SET expiry_date=? WHERE batch_no='B-NEAR-EXPIRY'", ((now().date()-timedelta(days=1)).isoformat(),))
            stock_id = db.execute("SELECT s.id FROM stock s JOIN lots l ON l.id=s.lot_id WHERE batch_no='B-NEAR-EXPIRY'").fetchone()[0]
    assert client.post('/api/movements', json=outbound(stock_id=stock_id), headers=admin).status_code == 400
    data = outbound(stock_id=stock_id)
    data['reason'] = 'damage'
    assert client.post('/api/movements', json=data, headers=admin).status_code == 201


def test_batch_metadata_cannot_silently_change(client, admin):
    assert client.post('/api/movements', json=inbound(), headers=admin).status_code == 201
    response = client.post('/api/movements', json=inbound(unit_volume_cm3=2000), headers=admin)
    assert response.status_code == 400
    assert '同一批次' in response.json['error']


def test_invalid_payloads_do_not_crash_or_mutate(client, admin):
    before = client.get('/api/data').json['stock']
    for invalid in [inbound(quantity=-1), inbound(quantity=1.2), inbound(quantity=True),
                    inbound(quantity='bad'), inbound(production_date='2026-99-99'),
                    inbound(expiry_date='2000-01-01'), inbound(location_id=9999),
                    inbound(unit_volume_cm3=0), inbound(auto_allocate='true')]:
        assert client.post('/api/movements', json=invalid, headers=admin).status_code == 400
    assert client.post('/api/movements', json=[], headers=admin).status_code == 400
    assert client.get('/api/data').json['stock'] == before


def test_product_crud_lookup_and_archive(client, admin):
    data = dict(name='测试商品', sku='TEST_001', category_id=1, unit='盒', length_cm=10,
                width_cm=10, height_cm=10, price='12.50', reorder_point=5, description='测试介绍', images=[])
    result = client.post('/api/products', json=data, headers=admin)
    assert result.status_code == 200
    product_id = result.json['id']
    assert client.get('/api/products/lookup?sku=TEST_001').json['product']['price_cents'] == 1250
    assert client.post('/api/products', json=data, headers=admin).status_code == 400
    assert client.put(f'/api/products/{product_id}', json={**data, 'name':'已更新'}, headers=admin).status_code == 200
    assert client.post(f'/api/products/{product_id}/archive', json={}, headers=admin).status_code == 200
    assert client.get('/api/products/lookup?sku=TEST_001').status_code == 404
    assert client.post('/api/products/1/archive', json={}, headers=admin).status_code == 400


def test_location_capacity_and_archive_guards(client, admin):
    result = client.put('/api/locations/1', json=dict(code='A-01-01', zone='A区', capacity_liters='0.001'), headers=admin)
    assert result.status_code == 400
    assert client.post('/api/locations/1/archive', json={}, headers=admin).status_code == 400
    response = client.post('/api/locations', json=dict(code='E-01-01', zone='新区', capacity_liters=20), headers=admin)
    assert response.status_code == 200
    assert client.post(f'/api/locations/{response.json["id"]}/archive', json={}, headers=admin).status_code == 200


def test_account_management_and_password_reset(client, admin):
    data = dict(username='readonly', display_name='观察员', password='ReadOnly123!', role='operator', permissions=[], active=True)
    result = client.post('/api/users', json=data, headers=admin)
    assert result.status_code == 200
    readonly_id = result.json['id']
    assert client.put('/api/users/1', json={**data, 'username':'admin', 'role':'operator'}, headers=admin).status_code == 400
    headers = login(client, 'readonly', 'ReadOnly123!')
    assert client.post('/api/movements', json=inbound(), headers=headers).status_code == 403
    assert client.get('/api/export/inventory.csv').status_code == 200
    assert client.post('/api/password', json={'old_password':'ReadOnly123!', 'new_password':'NewRead123!'}, headers=headers).status_code == 200
    assert login(client, 'readonly', 'NewRead123!')
    admin = login(client)
    assert client.put(f'/api/users/{readonly_id}', json={**data, 'password':'', 'active':False}, headers=admin).status_code == 200


def test_upload_validates_actual_image_and_csv_export(client, admin):
    response = client.post('/api/uploads', data={'file':(io.BytesIO(b'<svg/>'), 'fake.png')}, headers=admin)
    assert response.status_code == 400
    buffer = io.BytesIO()
    Image.new('RGB', (40,40), 'green').save(buffer, 'PNG')
    buffer.seek(0)
    response = client.post('/api/uploads', data={'file':(buffer, 'product.png')}, headers=admin)
    assert response.status_code == 201
    assert client.get(response.json['url']).status_code == 200
    exported = client.get('/api/export/inventory.csv')
    assert exported.status_code == 200
    assert exported.data.decode('utf-8-sig').startswith('商品编码,商品名称,分类,批次')


def test_concurrent_outbound_never_oversells(app, client, admin):
    # 笔只有18支，两笔各12支并发销售，最多只能成功一笔。
    def sell():
        with app.test_client() as worker:
            headers = login(worker, 'staff', 'Staff123!')
            return worker.post('/api/movements', json={'product_id':6,'direction':'out','reason':'sale','quantity':12}, headers=headers).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: sell(), range(2)))
    assert sorted(results) == [201,400]
    data = client.get('/api/data').json
    assert next(p for p in data['products'] if p['id']==6)['quantity'] == 6
