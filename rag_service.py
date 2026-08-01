"""SecondBrain RAG：语义检索（ChromaDB + sentence-transformers，lazy load，失败静默降级）。"""
import os
import sys
import threading

from sb_integration import SECOND_BRAIN_ROOT

# ===== SecondBrain RAG（向量语义检索） =====
RAG_INDEX_DIR = os.path.join(SECOND_BRAIN_ROOT, ".rag-index")
_RAG_MODEL = None
_RAG_COLLECTION = None
_RAG_LOAD_LOCK = threading.Lock()


def _rag_load():
    """lazy load 嵌入模型 + ChromaDB collection（进程内常驻，只加载一次）"""
    global _RAG_MODEL, _RAG_COLLECTION
    if _RAG_COLLECTION is not None:
        return _RAG_COLLECTION
    with _RAG_LOAD_LOCK:
        if _RAG_COLLECTION is not None:
            return _RAG_COLLECTION
        if not os.path.exists(RAG_INDEX_DIR):
            return None
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_OFFLINE"] = "1"
        import chromadb
        from sentence_transformers import SentenceTransformer
        _RAG_MODEL = SentenceTransformer('BAAI/bge-small-zh-v1.5')
        client = chromadb.PersistentClient(str(RAG_INDEX_DIR))
        _RAG_COLLECTION = client.get_collection("secondbrain")
    return _RAG_COLLECTION


def rag_query(q, subject="", top_k=3):
    """语义检索 SecondBrain 笔记。失败/无索引返回 []（静默降级，不影响主功能）"""
    try:
        collection = _rag_load()
        if collection is None or _RAG_MODEL is None or not q:
            return []
        query_emb = _RAG_MODEL.encode(q).tolist()
        where = {"subject": subject} if subject else None
        results = collection.query(query_embeddings=[query_emb], n_results=max(1, min(top_k, 10)), where=where)
        ids = results.get("ids", [[]])[0]
        if not ids:
            return []
        items = []
        for doc, meta, dist in zip(results["documents"][0], results["metadatas"][0], results["distances"][0]):
            items.append({
                "file": meta.get("file", "?"),
                "source": meta.get("source", ""),
                "subject": meta.get("subject", ""),
                "header": meta.get("header", ""),
                "score": round((1 - dist) * 100, 1),
                "snippet": (doc or "")[:300],
            })
        return items
    except Exception as e:  # noqa: BLE001 - RAG 失败静默降级：查询失败返回空列表
        print(f"[rag] query failed: {e}", file=sys.stderr)
        return []
