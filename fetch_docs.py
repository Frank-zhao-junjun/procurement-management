from coze_coding_dev_sdk.fetch import FetchClient

client = FetchClient()

# Fetch all source files
files = [
    ("service.py", "https://coze-coding-project.tos.coze.site/create_attachment/2026-03-22/649162924251600_28fdf3afebb61b11aee8b40891a2652d_service.py?sign=4896232463-1b883af16b-0-c122651804278a67e0eba250d60d42b07371856fa93c17d36efd9dc365ab393c"),
    ("db.py", "https://coze-coding-project.tos.coze.site/create_attachment/2026-03-22/649162924251600_5bed1822cfb8a6d62351b2f381fe8163_db.py?sign=4896232460-6fb6e8ee8c-0-1d81e824b1dc993b91a04fc37c369219de94504dac7024d4d3c40e32e86f4f9f"),
    ("cli.py", "https://coze-coding-project.tos.coze.site/create_attachment/2026-03-22/649162924251600_fad6441132bf6d36f9dfae91c577540c_cli.py?sign=4896232458-8d6e1e19e1-0-6bc13410aa1f7486affb0febd566d47b58a079a29122f9b4a5c5a768abbfeb9c"),
    ("__init__.py", "https://coze-coding-project.tos.coze.site/create_attachment/2026-03-22/649162924251600_cb2c6f3f621e4c7970e6cfad9270a545___init__.py?sign=4896232451-e8a4359cb2-0-444f2921c7b4f8ac618896597819c64bad940f769533d0cc67cf03b4984742a5"),
    ("__main__.py", "https://coze-coding-project.tos.coze.site/create_attachment/2026-03-22/649162924251600_f9f388a2749d2ef2b34bceb6a652cf63___main__.py?sign=4896232455-f0d3abeb6b-0-085db71331248b2be6fdab8659ac4cc108863dd2ab49c39c9e63ff6ed3dddb87"),
    ("pyproject.toml", "https://coze-coding-project.tos.coze.site/create_attachment/2026-03-22/649162924251600_e3e5da6c42f83fbaf2921b4ffcb380d4_pyproject.toml?sign=4896232442-bb868225b7-0-0cb82b6575381d9208f228b60a301471511327c14f75ca18b6e83baab2dfac76"),
    ("requirements.txt", "https://coze-coding-project.tos.coze.site/create_attachment/2026-03-22/649162924251600_a0d07fcebbff7d15ce4aee640ea6bfb9_requirements.txt?sign=4896232436-7f4044c247-0-d004c8109f462223fc171e8373d25ceb1671743ee52a207c55cb58a40467eb82"),
]

for filename, url in files:
    print(f"\n{'='*60}")
    print(f"=== {filename} ===")
    print('='*60)
    response = client.fetch(url=url)
    for item in response.content:
        if item.type == "text":
            print(item.text)
