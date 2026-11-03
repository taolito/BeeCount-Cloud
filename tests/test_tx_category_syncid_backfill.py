"""0022 存量回填 read_tx_projection.category_sync_id 的语义与幂等性。

覆盖 CSV 导入留下的「只有分类名/kind,没有 sync_id」行,以及三条边界:
同名多分类、kind 不匹配、category_kind 缺失 —— 全部保持 NULL(宁缺勿错)。
"""
import importlib.util
from pathlib import Path

from sqlalchemy import create_engine, text


def _load_module():
    path = Path(__file__).parents[1] / "alembic/versions/0022_backfill_tx_category_sync_id.py"
    spec = importlib.util.spec_from_file_location("tx_category_syncid_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _seed(db) -> None:
    db.execute(text(
        "CREATE TABLE user_category_projection "
        "(user_id TEXT, sync_id TEXT, name TEXT, kind TEXT)"
    ))
    db.execute(text(
        "CREATE TABLE read_tx_projection "
        "(ledger_id TEXT, sync_id TEXT, user_id TEXT, "
        " category_sync_id TEXT, category_name TEXT, category_kind TEXT)"
    ))
    cats = [
        ("u1", "cat_food", "外出就餐", "expense"),
        ("u1", "cat_dup_a", "杂项", "expense"),
        ("u1", "cat_dup_b", "杂项", "expense"),
        ("u1", "cat_salary", "工资薪金", "income"),
    ]
    for u, s, n, k in cats:
        db.execute(
            text("INSERT INTO user_category_projection VALUES (:u,:s,:n,:k)"),
            {"u": u, "s": s, "n": n, "k": k},
        )
    txs = [
        # 唯一命中 → 补全
        ("l1", "tx_unique", "u1", None, "外出就餐", "expense"),
        # 同名两分类 → 保持 NULL
        ("l1", "tx_ambiguous", "u1", None, "杂项", "expense"),
        # 名字命中但 kind 不匹配 → 保持 NULL
        ("l1", "tx_wrong_kind", "u1", None, "外出就餐", "income"),
        # 只有真实存在的 income 分类才补
        ("l1", "tx_income", "u1", None, "工资薪金", "income"),
        # category_kind 缺失 → 保持 NULL
        ("l1", "tx_no_kind", "u1", None, "外出就餐", None),
        # 已有 sync_id → 不改写
        ("l1", "tx_existing", "u1", "cat_food", "外出就餐", "expense"),
        # u2 自己没有这个分类,不能借 u1 的同名分类补
        ("l2", "tx_other_user", "u2", None, "外出就餐", "expense"),
    ]
    for ledger, sid, uid, cid, cn, ck in txs:
        db.execute(
            text("INSERT INTO read_tx_projection VALUES (:l,:s,:u,:cid,:cn,:ck)"),
            {"l": ledger, "s": sid, "u": uid, "cid": cid, "cn": cn, "ck": ck},
        )


def test_backfill_repairs_only_unambiguous_matches():
    module = _load_module()
    engine = create_engine("sqlite://")
    with engine.begin() as db:
        _seed(db)

        def read():
            return {
                r.sync_id: r.category_sync_id
                for r in db.execute(text("SELECT sync_id, category_sync_id FROM read_tx_projection"))
            }

        for statement in module.BACKFILL_STATEMENTS:
            db.execute(text(statement))

        after = read()
        assert after["tx_unique"] == "cat_food"
        assert after["tx_income"] == "cat_salary"
        assert after["tx_existing"] == "cat_food"
        for sid in ["tx_ambiguous", "tx_wrong_kind", "tx_no_kind", "tx_other_user"]:
            assert after[sid] is None, f"{sid} must stay NULL, got {after[sid]!r}"

        # 幂等:再跑一次不改动任何行
        for statement in module.BACKFILL_STATEMENTS:
            db.execute(text(statement))
        assert read() == after
