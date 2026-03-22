# 采购管理 · procurement-management

面向 **Agent 与人机协作** 的采购管理需求与原型代码。GitHub 仓库名：**procurement-management**（公开仓库）。

## 需求主本

- **规格说明书（v1.6）**：[docs/采购管理系统需求规格说明书_v1.6.md](docs/采购管理系统需求规格说明书_v1.6.md)  
- **实现差距清单（对照 Next 快照 `181322`，上一版 `175011`）**：[docs/实现差距清单_v1.6-对照project_20260322_181322.md](docs/实现差距清单_v1.6-对照project_20260322_181322.md) · [175011 版存档](docs/实现差距清单_v1.6-对照project_20260322_175011.md)

v1 **须一次性实现规格全文**（含 §1.3、§10.3 全量索引）；实现与规格不一致时 **以规格为准**。

## 仓库里有什么

| 内容 | 说明 |
|------|------|
| `docs/` | 需求规格、差距对照等文档 |
| `src/procurement/` | **SQLite + JSON 的 Python CLI 原型**（与 v1.6 全文尚未对齐） |
| `_review_extract/` | 供评审解压的 **Next.js + Supabase** 快照（非唯一实现路径） |

## Python CLI 原型 — 安装

```powershell
cd <本仓库根目录>
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
```

数据库默认：`data/procurement.db`。可用环境变量 `PROCUREMENT_DB` 覆盖。

## 常用命令（CLI）

```powershell
procurement supplier-upsert --name "某某科技" --contact "zhang@example.com"
procurement catalog-add --name "M3 螺丝" --unit "个" --sku "HW-M3"
procurement request-create --requester "老板" --reason "产线补货" --lines "[{\"description\":\"M3 螺丝\",\"qty\":500,\"est_unit_price\":0.05}]"
procurement request-submit --id 1
procurement request-approve --id 1
procurement po-create --request-id 1 --supplier-id 1 --lines "[{\"description\":\"M3 螺丝\",\"qty\":500,\"unit_price\":0.048}]"
procurement po-status --id 1 --status sent
procurement export
procurement po-list
```

合成演示（独立演示库，**不代表**需求已满足）：

```powershell
procurement demo
```

未安装 editable 包时：

```powershell
$env:PYTHONPATH = "<本仓库根目录>\src"
python -m procurement --help
```

## Agent 使用说明

见 [AGENT.md](AGENT.md)。

## 在 GitHub 上创建本仓库（Public + README）

1. 打开 [github.com/new](https://github.com/new)，Owner 选你的账号。  
2. **Repository name**：`procurement-management`  
3. 选 **Public**。  
4. **不要**勾选 “Add a README”（本仓库已有本文件，避免首次 push 与远程 README 冲突）。  
5. Create repository 后，在本地执行：

```bash
git init
git branch -M main
git add .
git commit -m "Initial commit: procurement-management"
git remote add origin https://github.com/Frank-zhao-junjun/procurement-management.git
git push -u origin main
```

若你已在网页上勾选了 “Add a README”，需先拉再推：

```bash
git pull origin main --allow-unrelated-histories
# 解决冲突后
git push -u origin main
```

## 许可证

若需开源许可证，请在仓库设置中补充 `LICENSE`（如 MIT）。
