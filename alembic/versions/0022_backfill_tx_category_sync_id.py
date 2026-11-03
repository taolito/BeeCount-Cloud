"""read_tx_projection: 存量回填 category_sync_id

CSV 导入建交易时 payload 只带 categoryName/categoryKind,不带 categoryId
(`_build_tx_payload`),而投影 upsert 只从 categoryId 取 category_sync_id
(账户有 #41 的按名兜底,分类没有)→ 导入的存量行 category_sync_id 全为
NULL。分类页笔数、按分类过滤的统计和分类预算区间都按 category_sync_id 聚合,
于是全部读 0。

此迁移对「id 为空且 (user_id, 分类名, kind) 唯一对应一个分类」的行补全
sync_id;同名多分类(跨父/叶重名)不处理,宁缺勿错。

Revision ID: 0022_backfill_tx_category_sync_id
Revises: 0021_mcp_workflows
Create Date: 2026-11-03
"""

import sqlalchemy as sa
from alembic import op


revision = "0022_backfill_tx_category_sync_id"
down_revision = "0021_mcp_workflows"
branch_labels = None
depends_on = None


# SQLite / PostgreSQL 双兼容:相关子查询用 MIN()+COUNT()=1 守卫,避免方言 GROUP BY 问题。
# 供测试直接 import 复用。
BACKFILL_STATEMENTS = [
    """
    UPDATE read_tx_projection
    SET category_sync_id = (
        SELECT MIN(c.sync_id) FROM user_category_projection c
        WHERE c.user_id = read_tx_projection.user_id
          AND c.name = read_tx_projection.category_name
          AND c.kind = read_tx_projection.category_kind
    )
    WHERE category_sync_id IS NULL
      AND category_name IS NOT NULL
      AND category_kind IS NOT NULL
      AND (SELECT COUNT(*) FROM user_category_projection c2
           WHERE c2.user_id = read_tx_projection.user_id
             AND c2.name = read_tx_projection.category_name
             AND c2.kind = read_tx_projection.category_kind) = 1
    """,
]


def upgrade() -> None:
    bind = op.get_bind()
    for stmt in BACKFILL_STATEMENTS:
        result = bind.execute(sa.text(stmt))
        rowcount = getattr(result, "rowcount", None)
        if rowcount is not None:
            print(f"backfill rowcount: {rowcount}")


def downgrade() -> None:
    # 回填不可逆,但补的是本就该有的引用,留存无害。
    pass
