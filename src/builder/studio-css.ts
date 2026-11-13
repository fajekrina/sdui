/// The Studio stylesheet. Installed as a constructable stylesheet (`adoptedStyleSheets`,
/// CSSOM — allowed under `style-src 'self'`), or shipped as `@fajekrina/sdui/builder/studio.css`
/// for apps that link it themselves (`stylesheet: 'external'`).
export const STUDIO_CSS = `
.sdui-studio{display:flex;flex-direction:column;height:100%;min-height:560px;font:13px/1.4 system-ui,sans-serif;color:#0f172a;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.sdui-studio *{box-sizing:border-box}
.sdui-studio button,.sdui-studio select,.sdui-studio input,.sdui-studio textarea{font:inherit}
.sdui-studio .tb{display:flex;gap:6px;align-items:center;padding:8px;border-bottom:1px solid #e2e8f0;background:#fff;flex-wrap:wrap}
.sdui-studio .tb .sp{flex:1}
.sdui-studio .tb .ttl{font-size:12px;color:#64748b}
.sdui-studio .tb .st{font-size:12px}
.sdui-studio .tb .st.ok{color:#16a34a}
.sdui-studio .tb .st.err{color:#dc2626}
.sdui-studio .btn{height:28px;padding:0 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer}
.sdui-studio .btn:disabled{opacity:.4;cursor:default}
.sdui-studio .btn.pri{background:#2563eb;border-color:#2563eb;color:#fff}
.sdui-studio .btn.on{background:#0f172a;border-color:#0f172a;color:#fff}
.sdui-studio .main{flex:1;display:grid;grid-template-columns:230px 1fr 290px;min-height:0}
.sdui-studio .main.pv{grid-template-columns:1fr}
.sdui-studio .main.pv>.col:not(.canvas){display:none}
.sdui-studio .col{display:flex;flex-direction:column;min-height:0;overflow:auto;border-right:1px solid #e2e8f0;background:#fff}
.sdui-studio .col h3{margin:0;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:1px solid #f1f5f9}
.sdui-studio .col .tip{padding:4px 10px 0;font-size:11px;color:#94a3b8}
.sdui-studio .pal{display:flex;flex-wrap:wrap;gap:4px;padding:8px}
.sdui-studio .pal button{border:1px solid #e2e8f0;background:#f8fafc;border-radius:4px;padding:2px 6px;cursor:grab}
.sdui-studio .row{display:flex;align-items:center;gap:4px;padding:3px 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sdui-studio .row.sel{background:#dbeafe}
.sdui-studio .canvas{background:#f1f5f9;padding:16px;overflow:auto}
.sdui-studio .device{flex-shrink:0;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:12px;min-height:200px}
.sdui-studio .device .hint{padding:8px;border:1px dashed #cbd5e1;border-radius:6px;color:#94a3b8;font-size:12px;text-align:center}
.sdui-studio .device [data-label]{position:relative}
.sdui-studio .device [data-label]::after{content:attr(data-label);position:absolute;top:-18px;left:0;padding:0 6px;border-radius:4px;background:#2563eb;color:#fff;font:10px/16px system-ui,sans-serif;white-space:nowrap;pointer-events:none;z-index:1}
.sdui-studio [data-drop="inside"]{box-shadow:inset 0 0 0 2px #22c55e!important}
.sdui-studio [data-drop="before"]{box-shadow:0 -3px 0 0 #22c55e!important}
.sdui-studio [data-drop="after"]{box-shadow:0 3px 0 0 #22c55e!important}
.sdui-studio .insp{padding:8px;display:flex;flex-direction:column;gap:8px}
.sdui-studio .insp label{display:flex;flex-direction:column;gap:2px;font-size:12px;color:#475569}
.sdui-studio .insp label.chk{flex-direction:row;align-items:center;gap:6px}
.sdui-studio .insp input,.sdui-studio .insp select,.sdui-studio .insp textarea{border:1px solid #cbd5e1;border-radius:4px;padding:4px 6px;background:#fff;color:#0f172a}
.sdui-studio .insp textarea{font-family:ui-monospace,monospace;font-size:11px;min-height:56px}
.sdui-studio .insp fieldset{border:1px solid #e2e8f0;border-radius:6px;display:flex;flex-direction:column;gap:6px;padding:8px}
.sdui-studio .insp details{border-left:2px solid #e2e8f0;padding-left:8px}
.sdui-studio .insp summary{cursor:pointer;font-size:12px;color:#475569}
.sdui-studio .insp .act{display:flex;flex-direction:column;gap:6px}
.sdui-studio .insp .acts{display:flex;gap:4px;flex-wrap:wrap}
.sdui-studio .json{border-top:1px solid #e2e8f0;background:#0f172a;color:#e2e8f0;display:flex;flex-direction:column}
.sdui-studio .json .hd{display:flex;align-items:center;gap:8px;padding:4px 8px;background:#1e293b}
.sdui-studio .json .badge{font-size:11px;border:1px solid #60a5fa;border-radius:999px;padding:0 8px;color:#bfdbfe}
.sdui-studio .json .body{position:relative;height:220px;overflow:hidden}
.sdui-studio .json textarea{position:absolute;inset:0;width:100%;height:100%;background:transparent;color:#e2e8f0;border:0;padding:8px;font:12px/18px ui-monospace,monospace;white-space:pre;overflow:auto;resize:none;outline:none}
.sdui-studio .json .band{position:absolute;left:0;right:0;background:rgba(96,165,250,.16);border-left:3px solid #60a5fa;pointer-events:none}
.sdui-studio .issues{padding:4px 8px;font-size:12px;color:#fca5a5;background:#1e293b}
.sdui-studio .warn{color:#fcd34d}
.sdui-studio .key{width:140px;height:28px;border:1px solid #cbd5e1;border-radius:6px;padding:0 6px}
.sdui-studio .empty{color:#94a3b8;text-align:center}
.sdui-studio .note{height:28px;width:180px;border:1px solid #cbd5e1;border-radius:6px;padding:0 6px}
.sdui-studio .changes{max-height:160px;overflow:auto;padding:4px 8px;font:12px/1.5 ui-monospace,monospace;color:#cbd5e1;background:#0f172a;border-top:1px solid #1e293b}
.sdui-studio .changes .hd{color:#e2e8f0;font-weight:600}
.sdui-studio .changes .added{color:#86efac}
.sdui-studio .changes .removed{color:#fca5a5}
.sdui-studio .changes .changed,.sdui-studio .changes .moved{color:#fcd34d}
.sdui-studio [hidden]{display:none!important}
`
