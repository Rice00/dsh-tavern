function SessionInventoryDialog(props) {
    const [result, setResult] = React.useState(null);
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const [page, setPage] = React.useState(0);
    const generation = React.useRef(0);
    const h = React.createElement;
    async function refresh() {
        const ticket = ++generation.current;
        setBusy(true); setError("");
        try {
            const value = await rpc("getSessionInventory", {}, props.sessionId);
            if (ticket === generation.current) { setResult(value); setPage(0); }
        } catch (error) { if (ticket === generation.current) setError(String(error.message || error)); }
        finally { if (ticket === generation.current) setBusy(false); }
    }
    React.useEffect(() => { refresh(); return () => { generation.current++; }; }, [props.sessionId]);
    const bytes = value => value == null ? "未知" : (value / 1024 / 1024).toFixed(2) + " MiB";
    const date = value => value ? new Date(value).toLocaleString() : "未知";
    const rows = (result?.rows || []).filter(row => (row.sessionId + " " + row.references.map(ref => ref.title).join(" ")).toLowerCase().includes(query.toLowerCase()));
    return h("div", { role: "dialog", "aria-modal": true, "aria-label": "会话统计", className: "dsh-tavern-modal-backdrop", onKeyDown: event => {
        if (event.key === "Escape") { event.stopPropagation(); props.onClose(); }
        if (event.key === "Tab") {
            const controls = [...event.currentTarget.querySelectorAll("button:not(:disabled), input")];
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
        }
    }, style: { position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center" } },
        h("section", { className: "dsh-tavern-panel", style: { background: "var(--background, Canvas)", color: "var(--foreground, CanvasText)", padding: 20, width: "min(1100px, 94vw)", maxHeight: "85vh", overflow: "auto" } },
            h("h2", null, "会话统计"),
            h("p", null, "只读统计，不加载历史。事件数仅统计已加载会话；磁盘大小不是内存占用。引用仅覆盖 Tavern 直接关联，未找到引用不代表孤儿会话。"),
            h("button", { type: "button", disabled: busy, onClick: refresh }, busy ? "读取中…" : "刷新"),
            h("button", { type: "button", autoFocus: true, onClick: props.onClose }, "关闭"),
            error ? h("p", { role: "alert" }, error) : null,
            result ? h("p", null, "会话 " + result.totals.sessions + " · 已加载 " + result.totals.loaded + " · 已知磁盘占用 " + bytes(result.totals.knownDiskBytes) + "（" + result.totals.unknownDiskSize + " 条未知） · 进程 RSS " + bytes(result.memory.rss) + " · JS 堆 " + bytes(result.memory.heapUsed) + " · 采样 " + date(result.capturedAt)) : null,
            h("input", { "aria-label": "筛选会话", placeholder: "会话 ID 或对话名称", value: query, onChange: event => { setQuery(event.target.value); setPage(0); } }),
            h("table", { style: { width: "100%", textAlign: "left" } },
                h("thead", null, h("tr", null, ["会话", "状态", "事件数", "磁盘大小", "文件修改时间", "Tavern 直接引用 / 最后打开"].map(label => h("th", { key: label }, label)))),
                h("tbody", null, rows.slice(page * 50, (page + 1) * 50).map(row => h("tr", { key: row.sessionId },
                    h("td", { style: { overflowWrap: "anywhere" } }, row.sessionId),
                    h("td", null, (row.running ? "运行中" : row.loaded ? "已加载" : "未加载") + (row.archived === true ? " · 已归档" : row.archived === null ? " · 归档状态未知" : "")),
                    h("td", null, row.eventCount == null ? "未知" : row.eventCount),
                    h("td", null, row.storageError || bytes(row.diskBytes)),
                    h("td", null, date(row.fileModifiedAt)),
                    h("td", null, row.references.length ? row.references.map(ref => h("div", { key: ref.chatId }, ref.title + " · " + date(ref.lastOpenedAt))) : "未找到直接引用")
                )))),
            h("p", null, rows.length + " 条 · 第 " + (page + 1) + " 页"),
            h("button", { type: "button", disabled: page === 0, onClick: () => setPage(page - 1) }, "上一页"),
            h("button", { type: "button", disabled: (page + 1) * 50 >= rows.length, onClick: () => setPage(page + 1) }, "下一页")
        ));
}
