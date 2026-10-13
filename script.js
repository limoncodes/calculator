/* ==========================================================
   Calculator logic (vanilla JavaScript, no eval)
   ========================================================== */

(function () {
    'use strict';

    const MAX_EXPRESSION_LENGTH = 40;
    const MAX_DIGITS = 15;

    const expressionEl = document.getElementById('expression');
    const resultEl = document.getElementById('result');
    const keysEl = document.getElementById('keys');

    // The expression is stored with plain ASCII operators: + - * /
    // and "%" after a number. It is prettified only when displayed.
    const state = {
        expression: '',       // what the user has typed, e.g. "12+3*4"
        lastExpression: '',   // shown above the result after pressing "="
        justEvaluated: false, // true right after "=" was pressed
        overrideText: null,   // used for results too large/small to re-type
        error: null           // error message, or null
    };

    /* ---------- Small helpers ---------- */

    function isOperator(char) {
        return char === '+' || char === '-' || char === '*' || char === '/';
    }

    // Returns the number being typed at the end of the expression ("" if none)
    function getLastNumber(expression) {
        return /\d*\.?\d*$/.exec(expression)[0];
    }

    // Removes operators left dangling at the end, e.g. "5+" -> "5"
    function stripTrailingOperators(expression) {
        return expression.replace(/[+\-*/]+$/, '');
    }

    // A single number such as "12", "-3.5" or "0." (nothing to calculate)
    function isLoneNumber(expression) {
        return /^-?\d*\.?\d*$/.test(expression);
    }

    /* ---------- Calculation (recursive descent parser) ----------
       Grammar:
         expression = term   (("+" | "-") term)*
         term       = unary  (("*" | "/") unary)*
         unary      = "-" unary | number "%"*
       Multiplication and division are handled before addition and
       subtraction, which gives correct operator precedence.
    ------------------------------------------------------------- */

    function evaluate(input) {
        let pos = 0;

        function peek() {
            return input[pos];
        }

        function parseNumber() {
            const match = /^(\d+\.?\d*|\.\d+)/.exec(input.slice(pos));
            if (!match) throw new Error('SYNTAX');
            pos += match[0].length;

            let value = parseFloat(match[0]);
            let isPercent = false;
            while (peek() === '%') {
                pos++;
                value /= 100;
                isPercent = true;
            }
            return { value, isPercent };
        }

        function parseUnary() {
            if (peek() === '-') {
                pos++;
                const operand = parseUnary();
                return { value: -operand.value, isPercent: operand.isPercent };
            }
            return parseNumber();
        }

        function parseTerm() {
            const left = parseUnary();
            let compound = false;

            while (peek() === '*' || peek() === '/') {
                const op = input[pos++];
                const right = parseUnary();
                compound = true;

                if (op === '/') {
                    if (right.value === 0) throw new Error('DIV0');
                    left.value /= right.value;
                } else {
                    left.value *= right.value;
                }
            }
            return { value: left.value, isPercent: compound ? false : left.isPercent };
        }

        function parseExpression() {
            let total = parseTerm().value;

            while (peek() === '+' || peek() === '-') {
                const op = input[pos++];
                const term = parseTerm();
                // "200 + 10%" means 200 plus 10% of 200
                const amount = term.isPercent ? total * term.value : term.value;
                total = op === '+' ? total + amount : total - amount;
            }
            return total;
        }

        const value = parseExpression();
        if (pos !== input.length) throw new Error('SYNTAX');
        if (!Number.isFinite(value)) throw new Error('OVERFLOW');
        return value;
    }

    // Removes floating point noise: 0.1 + 0.2 -> 0.3
    function roundResult(value) {
        const rounded = Number(value.toPrecision(12));
        return rounded === 0 ? 0 : rounded;
    }

    /* ---------- Formatting ---------- */

    // Adds thousands separators: "1234567.89" -> "1,234,567.89"
    function groupDigits(text) {
        const negative = text.startsWith('-');
        const parts = (negative ? text.slice(1) : text).split('.');
        const integer = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        const decimals = parts.length > 1 ? '.' + parts[1] : '';
        return (negative ? '-' : '') + integer + decimals;
    }

    function formatNumber(value) {
        const rounded = roundResult(value);
        const abs = Math.abs(rounded);

        if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) {
            return rounded.toExponential(6).replace(/\.?0+e/, 'e');
        }
        return groupDigits(String(rounded));
    }

    // Makes the expression line look nice: "12*3-4" -> "12 × 3 − 4"
    function formatExpression(expression) {
        return expression
            .replace(/\d+(\.\d*)?/g, groupDigits)
            .replace(/([\d%])([+\-*/])/g, '$1 $2 ')
            .replace(/[*/-]/g, function (char) {
                return { '*': '×', '/': '÷', '-': '−' }[char];
            });
    }

    /* ---------- Input actions ---------- */

    function clearAll() {
        state.expression = '';
        state.lastExpression = '';
        state.justEvaluated = false;
        state.overrideText = null;
        state.error = null;
    }

    // Typing a number after a result (or an error) starts a fresh calculation
    function startFreshIfNeeded() {
        if (state.error || state.justEvaluated) clearAll();
    }

    function inputDigit(digit) {
        startFreshIfNeeded();

        const expression = state.expression;
        if (expression.slice(-1) === '%') return;
        if (expression.length >= MAX_EXPRESSION_LENGTH) return;

        const current = getLastNumber(expression);
        if (current.replace('.', '').length >= MAX_DIGITS) return;

        // Replace a lone leading zero instead of writing "05"
        if (current === '0') {
            state.expression = expression.slice(0, -1) + digit;
        } else {
            state.expression = expression + digit;
        }
    }

    function inputDecimal() {
        startFreshIfNeeded();

        const expression = state.expression;
        if (expression.slice(-1) === '%') return;
        if (expression.length >= MAX_EXPRESSION_LENGTH - 1) return;

        const current = getLastNumber(expression);
        if (current.includes('.')) return;

        state.expression = expression + (current === '' ? '0.' : '.');
    }

    function inputOperator(op) {
        if (state.error) clearAll();
        state.justEvaluated = false;
        state.overrideText = null;

        const expression = state.expression;

        // Nothing typed yet: only a minus sign is allowed (negative number)
        if (expression === '') {
            if (op === '-') state.expression = '-';
            return;
        }
        if (expression === '-') return;

        const last = expression.slice(-1);

        if (isOperator(last)) {
            // Allow "5 × -3"
            if (op === '-' && (last === '*' || last === '/')) {
                state.expression = expression + op;
            } else {
                // Otherwise swap the previous operator for the new one
                state.expression = stripTrailingOperators(expression) + op;
            }
            return;
        }

        if (expression.length >= MAX_EXPRESSION_LENGTH) return;
        state.expression = expression + op;
    }

    function inputPercent() {
        if (state.error) return;
        state.justEvaluated = false;
        state.overrideText = null;

        const expression = state.expression;
        if (/\d$/.test(expression) && expression.length < MAX_EXPRESSION_LENGTH) {
            state.expression = expression + '%';
        }
    }

    // Flips the sign of the number at the end of the expression
    function toggleSign() {
        if (state.error) return;
        state.justEvaluated = false;
        state.overrideText = null;

        const expression = state.expression;
        const number = getLastNumber(expression);
        if (number === '') return;

        const index = expression.length - number.length;
        const before = expression[index - 1];
        const beforeThat = expression[index - 2];

        if (before === '-' && (index - 1 === 0 || isOperator(beforeThat))) {
            // Remove a negative sign: "-5" -> "5", "3*-5" -> "3*5"
            state.expression = expression.slice(0, index - 1) + number;
        } else if (before === '-') {
            state.expression = expression.slice(0, index - 1) + '+' + number;
        } else if (before === '+') {
            state.expression = expression.slice(0, index - 1) + '-' + number;
        } else {
            state.expression = expression.slice(0, index) + '-' + number;
        }
    }

    function deleteLast() {
        if (state.error) {
            clearAll();
            return;
        }
        state.justEvaluated = false;
        state.overrideText = null;
        state.expression = state.expression.slice(0, -1);
    }

    function calculate() {
        if (state.error) return;

        const cleaned = stripTrailingOperators(state.expression);
        if (isLoneNumber(cleaned)) return; // nothing to calculate

        state.lastExpression = cleaned;

        try {
            const result = roundResult(evaluate(cleaned));
            const text = String(result);

            if (text.includes('e')) {
                // Very large or very small: show it, but it can't be typed further
                state.expression = '';
                state.overrideText = formatNumber(result);
            } else {
                state.expression = text;
                state.overrideText = null;
            }
            state.justEvaluated = true;
        } catch (error) {
            state.error =
                error.message === 'DIV0' ? "Can't divide by zero" :
                    error.message === 'OVERFLOW' ? 'Number too large' :
                        'Invalid expression';
            state.justEvaluated = false;
        }
    }

    /* ---------- Rendering ---------- */

    // The large line: a live result while typing, the answer after "="
    function getResultText() {
        if (state.overrideText !== null) return state.overrideText;

        const expression = state.expression;
        if (expression === '') return '0';
        if (isLoneNumber(expression)) return groupDigits(expression);

        try {
            const cleaned = stripTrailingOperators(expression);
            return formatNumber(evaluate(cleaned));
        } catch (error) {
            // e.g. "5/0" while typing: just show the number being typed
            return groupDigits(getLastNumber(expression) || '0');
        }
    }

    // Shrinks the font until the result fits on one line
    function fitResult() {
        resultEl.style.fontSize = '';
        if (state.error) return;

        let size = parseFloat(getComputedStyle(resultEl).fontSize);
        while (resultEl.scrollWidth > resultEl.clientWidth && size > 18) {
            size -= 2;
            resultEl.style.fontSize = size + 'px';
        }
    }

    function render() {
        let top;
        let bottom;

        if (state.error) {
            top = formatExpression(state.lastExpression);
            bottom = state.error;
        } else {
            top = state.justEvaluated
                ? formatExpression(state.lastExpression) + ' ='
                : formatExpression(state.expression);
            bottom = getResultText().replace(/^-/, '−');
        }

        resultEl.classList.toggle('is-error', Boolean(state.error));
        expressionEl.textContent = top;
        expressionEl.scrollLeft = expressionEl.scrollWidth;
        resultEl.textContent = bottom;
        fitResult();
    }

    /* ---------- Events ---------- */

    function handleAction(action, value) {
        switch (action) {
            case 'digit': inputDigit(value); break;
            case 'decimal': inputDecimal(); break;
            case 'operator': inputOperator(value); break;
            case 'percent': inputPercent(); break;
            case 'negate': toggleSign(); break;
            case 'delete': deleteLast(); break;
            case 'clear': clearAll(); break;
            case 'equals': calculate(); break;
        }
        render();
    }

    // Mouse / touch
    keysEl.addEventListener('click', function (event) {
        const button = event.target.closest('button');
        if (button) handleAction(button.dataset.action, button.dataset.value);
    });

    // Briefly highlights a button when its keyboard key is pressed
    function flashButton(action, value) {
        let selector = '[data-action="' + action + '"]';
        if (value !== undefined) selector += '[data-value="' + value + '"]';

        const button = keysEl.querySelector(selector);
        if (!button) return;

        button.classList.add('is-pressed');
        setTimeout(function () {
            button.classList.remove('is-pressed');
        }, 120);
    }

    // Keyboard
    document.addEventListener('keydown', function (event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        const key = event.key;
        let action = null;
        let value;

        if (key >= '0' && key <= '9' && key.length === 1) {
            action = 'digit'; value = key;
        } else if (key === '.' || key === ',') {
            action = 'decimal';
        } else if (key === '+' || key === '-' || key === '*' || key === '/') {
            action = 'operator'; value = key;
        } else if (key === 'x' || key === 'X') {
            action = 'operator'; value = '*';
        } else if (key === '%') {
            action = 'percent';
        } else if (key === 'Enter' || key === '=') {
            action = 'equals';
        } else if (key === 'Backspace') {
            action = 'delete';
        } else if (key === 'Escape') {
            action = 'clear';
        }

        if (!action) return;

        event.preventDefault(); // stops "/" quick-find and Enter re-clicking a focused button
        flashButton(action, value);
        handleAction(action, value);
    });

    window.addEventListener('resize', fitResult);

    render();
})();