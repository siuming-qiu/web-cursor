export default function extractField(args: string, field:
    string): string {
    const m = args.match(new
        RegExp(`\\{\\s*"${field}"\\s*:\\s*"`));
    if (!m) return "";
    const rest = args.slice((m.index ?? 0) +
        m[0].length);
    let out = "";
    for (let i = 0; i < rest.length; i++) {
        const c = rest[i];
        if (c === "\\") {
            const n = rest[i + 1];
            if (n === undefined) break;
            // 转义被截断
            if (n === "u") {
                out +=
                String.fromCharCode(parseInt(rest.slice(i + 2, i
                    + 6), 16) || 0); i += 5;
            }
            else {
                out += ({
                    n: "\n", t: "\t", r:
                        "\r", '"': '"', "\\": "\\", "/": "/"
                } as
                    Record<string, string>)[n] ?? n; i += 1;
            }
        } else if (c === '"') break;
        // 字符串结束
        else out += c;
    }
    return out;
}