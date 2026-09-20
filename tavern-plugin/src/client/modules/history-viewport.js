// Bound live story bodies independently of the host's child-slot ownership.
// Lightweight placeholders retain scroll geometry; canonical history is untouched.
function createTavernHistoryViewport(limit = 20) {
    const entries = new Map(), listeners = new Set();
    let snapshot = new Set();
    function publish(next) {
        if (next.size === snapshot.size && [...next].every(key => snapshot.has(key))) return;
        const previous = snapshot;
        snapshot = next;
        // Dispose retained documents before admitting their replacements.
        for (const key of previous) if (!next.has(key)) entries.get(key)?.release();
        listeners.forEach(fn => fn());
    }
    function ordered(sessionId) {
        return [...entries.values()].filter(item => item.sessionId === sessionId).sort((a, b) => a.turn - b.turn);
    }
    function select(sessionId, turn) {
        const rows = ordered(sessionId);
        const index = rows.findIndex(item => item.turn === turn);
        const end = index < 0 ? rows.length : Math.min(rows.length, Math.max(limit, index + Math.ceil(limit / 2)));
        publish(new Set(rows.slice(Math.max(0, end - limit), end).map(item => item.key)));
    }
    return {
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        snapshot() { return snapshot; },
        register(sessionId, turn, release) {
            const key = JSON.stringify([sessionId, turn]);
            const newest = ordered(sessionId).at(-1);
            const followingLatest = newest && snapshot.has(newest.key);
            let item = entries.get(key);
            if (!item) { item = { key, sessionId, turn, release, mounts: 0 }; entries.set(key, item); }
            item.mounts++;
            // Initial mount and newly appended turns start at the newest window.
            if (!snapshot.size || followingLatest && turn >= newest.turn) select(sessionId);
            return () => {
                if (--item.mounts > 0) return;
                item.release();
                entries.delete(key);
                publish(new Set([...snapshot].filter(k => k !== key)));
            };
        },
        focus(sessionId, turn) { if (!snapshot.has(JSON.stringify([sessionId, turn]))) select(sessionId, turn); },
        key(sessionId, turn) { return JSON.stringify([sessionId, turn]); }
    };
}
const tavernHistoryViewport = createTavernHistoryViewport();

function TavernWindowedNode(props) {
    const ref = React.useRef(null), height = React.useRef(160);
    const turn = Number(props.node.location?.turn?.turn || 0);
    const key = tavernHistoryViewport.key(props.sessionId, turn);
    const active = React.useSyncExternalStore(tavernHistoryViewport.subscribe, tavernHistoryViewport.snapshot).has(key);
    React.useLayoutEffect(() => tavernHistoryViewport.register(props.sessionId, turn, () => {
        // Story turns and native turns need not have the same numbering.
        tavernRetainedFrames.invalidateOwner(key);
    }), [key]);
    React.useLayoutEffect(() => {
        if (!active || !ref.current) return;
        const node = ref.current;
        const remember = () => { if (node.offsetHeight > 0) height.current = node.offsetHeight; };
        remember();
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(remember) : null;
        observer?.observe(node);
        return () => { remember(); observer?.disconnect(); };
    }, [active]);
    React.useEffect(() => {
        const node = ref.current;
        if (!node || typeof IntersectionObserver !== "function") return;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) tavernHistoryViewport.focus(props.sessionId, turn);
        }, { rootMargin: "240px 0px" });
        observer.observe(node);
        return () => observer.disconnect();
    }, [key]);
    return React.createElement("div", { ref, "data-tavern-history-turn": turn,
        style: active ? undefined : { minHeight: height.current + "px" } },
        active ? React.createElement(props.bodyComponent, { ...props, frameOwner: key }) :
            React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: () => tavernHistoryViewport.focus(props.sessionId, turn) }, "加载此段历史"));
}
