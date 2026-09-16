function ScriptNavigation(props) {
    const h = React.createElement;
    const [page, setPage] = React.useState(null);
    const [position, setPosition] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [notice, setNotice] = React.useState("");
    const [error, setError] = React.useState("");
    const generation = React.useRef(0);
    async function load(target) {
        const ticket = ++generation.current;
        setLoading(true); setError("");
        try {
            const result = await rpc("browseScript", target === undefined ? {} : { position: target }, props.sessionId);
            if (ticket === generation.current) setPage(result);
        } catch (err) { if (ticket === generation.current) setError(String(err.message || err)); }
        finally { if (ticket === generation.current) setLoading(false); }
    }
    React.useEffect(() => {
        setPage(null); setPosition(""); setNotice(""); setSaving(false);
        load();
        return () => { generation.current++; };
    }, [props.sessionId, props.cursor, props.total]);
    async function point(number) {
        if (props.busy || saving || loading || !page) return;
        const ticket = generation.current;
        setSaving(true); setError(""); setNotice("");
        try {
            const result = await rpc("pointScript", { position: number, revision: page.revision, cardPath: page.cardPath, scriptVersion: page.scriptVersion }, props.sessionId);
            if (ticket !== generation.current) return;
            setNotice(result.message);
            liveTavernView.invalidate(props.sessionId);
            setSaving(false);
            await load(number);
        } catch (err) { if (ticket === generation.current) setError(String(err.message || err)); }
        finally { if (ticket === generation.current) setSaving(false); }
    }
    function jump(event) {
        event.preventDefault();
        const number = Number(position);
        if (!Number.isSafeInteger(number) || number < 1 || number > (page?.totalChunks || 0)) { setError("请输入有效的剧本块号"); return; }
        load(number);
    }
    return h("section", { className: "dsh-tavern-status-section dsh-script-nav", "aria-label": "剧本块列表" },
        h("div", { className: "dsh-tavern-status-label" }, "剧本块"),
        h("p", { className: "dsh-script-nav-hint" }, "先浏览，再选择起点。调整将在下一轮生效。"),
        h("form", { className: "dsh-script-nav-toolbar", onSubmit: jump },
            h("input", { type: "number", min: 1, max: page?.totalChunks || 1, step: 1, "aria-label": "剧本块序号", placeholder: "块号", value: position, disabled: saving,
                onChange: event => setPosition(event.target.value) }),
            h("button", { type: "submit", disabled: loading || saving || !page?.totalChunks }, "浏览"),
            h("button", { type: "button", disabled: loading || saving, onClick: () => load() }, "当前游标")),
        error ? h("p", { role: "alert" }, error) : null,
        notice ? h("p", { role: "status" }, notice) : null,
        props.busy ? h("p", null, "任务进行中，可浏览，暂不能修改游标。") : null,
        loading ? h("p", { role: "status" }, "读取中…") : null,
        page ? h("div", null,
            h("p", { className: "dsh-script-nav-range" }, page.from + "–" + page.to + " / " + page.totalChunks + " 块" + (page.cursor >= page.totalChunks && page.totalChunks ? " · 剧本已结束" : "")),
            page.chunks.map(chunk => h("div", { key: chunk.number, className: "dsh-tavern-script-chunk dsh-script-nav-item", "aria-current": chunk.number === page.cursor + 1 ? "step" : undefined },
                h("details", null, h("summary", null, (chunk.number === page.cursor + 1 ? "当前 · " : "") + "第 " + String(chunk.number).padStart(2, "0") + " 块 · " + chunk.text.slice(0, 60)),
                    h("div", { className: "dsh-tavern-script-chunk-text", style: { whiteSpace: "pre-wrap" } }, chunk.text)),
                h("button", { type: "button", className: "dsh-script-nav-choose", disabled: props.busy || loading || saving || chunk.number === page.cursor + 1, onClick: () => point(chunk.number), "aria-label": "从第 " + chunk.number + " 块继续" }, "从这里继续"))),
            h("div", { className: "dsh-script-nav-pages" }, h("button", { type: "button", disabled: loading || saving || page.from <= 1, onClick: () => load(Math.max(1, page.from - 6)) }, "前 10 块"),
            h("button", { type: "button", disabled: loading || saving || page.to >= page.totalChunks, onClick: () => load(Math.min(page.totalChunks, page.from + 14)) }, "后 10 块"))) : null);
}
