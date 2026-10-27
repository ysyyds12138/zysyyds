"""校园便利店仓储管理系统入口。开发启动：python app.py。"""
import os
from warehouse import create_app

app = create_app()

if __name__ == '__main__':
    app.run(host=os.environ.get('HOST', '127.0.0.1'), port=int(os.environ.get('PORT', '5000')),
            debug=False)
