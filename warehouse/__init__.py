import os
import secrets
from datetime import timedelta
from pathlib import Path

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from .db import close_db, initialize


def create_app(config=None):
    app = Flask(__name__, instance_relative_config=True, template_folder='../templates',
                static_folder='../static')
    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    secret_file = Path(app.instance_path) / 'session.key'
    if not secret_file.exists():
        try:
            with secret_file.open('x') as handle:
                handle.write(secrets.token_hex(32))
            secret_file.chmod(0o600)
        except FileExistsError:
            pass
    app.config.from_mapping(
        SECRET_KEY=os.environ.get('WAREHOUSE_SECRET_KEY') or secret_file.read_text().strip(),
        DATABASE=str(Path(app.instance_path) / 'warehouse.sqlite3'),
        UPLOAD_FOLDER=str(Path(app.instance_path) / 'uploads'),
        MAX_CONTENT_LENGTH=8 * 1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=os.environ.get('WAREHOUSE_HTTPS') == '1',
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        SEED_DEMO=True,
    )
    if config:
        app.config.update(config)
    Path(app.config['UPLOAD_FOLDER']).mkdir(parents=True, exist_ok=True)
    app.teardown_appcontext(close_db)
    from .api import bp
    app.register_blueprint(bp)

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'same-origin'
        if request.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        if request.path.startswith('/api/'):
            return jsonify(error=error.description), error.code
        return error

    with app.app_context():
        initialize()
        if app.config['SEED_DEMO']:
            from .seed import seed_demo
            seed_demo()
    return app
