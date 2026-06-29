export function safeEval(expr) {
    let pos = 0;

    function skipWS() {
        while (pos < expr.length && expr[pos] === ' ') pos++;
    }

    function peek() {
        skipWS();
        return pos < expr.length ? expr[pos] : '\0';
    }

    function consume() {
        return expr[pos++];
    }

    function parseNumber() {
        skipWS();
        let num = '';
        if (expr[pos] === '-') { num += '-'; pos++; }
        while (pos < expr.length && /[0-9.]/.test(expr[pos])) num += expr[pos++];
        if (num === '' || num === '-') throw new Error();
        return parseFloat(num);
    }

    function parsePrimary() {
        skipWS();
        if (expr[pos] === '(') {
            pos++;
            const v = parseExpr();
            skipWS();
            if (expr[pos] !== ')') throw new Error();
            pos++;
            return v;
        }
        return parseNumber();
    }

    function parseFactor() {
        let v = parsePrimary();
        skipWS();
        while (pos < expr.length && (expr[pos] === '*' || expr[pos] === '/')) {
            const op = consume();
            const r = parsePrimary();
            v = op === '*' ? v * r : v / r;
            skipWS();
        }
        return v;
    }

    function parseExpr() {
        let v = parseFactor();
        skipWS();
        while (pos < expr.length && (expr[pos] === '+' || expr[pos] === '-')) {
            const op = consume();
            const r = parseFactor();
            v = op === '+' ? v + r : v - r;
            skipWS();
        }
        return v;
    }

    skipWS();
    if (pos >= expr.length) throw new Error();
    const result = parseExpr();
    skipWS();
    if (pos < expr.length) throw new Error('unexpected characters');
    if (!Number.isFinite(result)) throw new Error();
    return result;
}
