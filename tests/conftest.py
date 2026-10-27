import pytest
from warehouse import create_app


@pytest.fixture
def app(tmp_path):
    return create_app({'TESTING': True, 'DATABASE': str(tmp_path / 'test.sqlite3'),
                       'UPLOAD_FOLDER': str(tmp_path / 'uploads'), 'SECRET_KEY': 'test-only-key'})


@pytest.fixture
def client(app):
    return app.test_client()


def login(client, username='admin', password='Admin123!'):
    token = client.get('/api/session').json['csrf']
    response = client.post('/api/login', json={'username': username, 'password': password},
                           headers={'X-CSRF-Token': token})
    assert response.status_code == 200
    return {'X-CSRF-Token': response.json['csrf']}


@pytest.fixture
def admin(client):
    return login(client)
