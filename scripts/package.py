"""只打包源码、资源、测试和说明；不包含数据库、上传文件、密钥及虚拟环境。"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
output = root / 'dist' / 'qinghe-warehouse.zip'
output.parent.mkdir(exist_ok=True)
source_dirs = ['warehouse', 'templates', 'static', 'tests', 'scripts', 'docs']
source_files = ['.gitignore', 'README.md', 'app.py', 'requirements.txt', 'requirements-dev.txt',
                'requirements-browser.txt', 'start.sh', 'start.bat']
files = [root / name for name in source_files]
for directory in source_dirs:
    files.extend(file for file in (root / directory).rglob('*')
                 if file.is_file() and '__pycache__' not in file.parts and file.suffix != '.pyc')
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for file in sorted(files):
        archive.write(file, Path('qinghe-warehouse') / file.relative_to(root))
print(f'源码包已生成：{output}（{len(files)} 个文件）')
