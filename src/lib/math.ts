export const table: Record<number, number> = {};
export const rtable: Record<number, number> = {};

table[0] = 1;
rtable[1] = 0;

for (let key = 1; key <= 254; key++) {
    let val = table[key - 1] * 2;
    if (val >= 256) val ^= 285;
    table[key] = val;
    rtable[val] = key;
}

table[255] = 1;

export function multiply(x: number[], y: number[]) {
    const output: number[] = new Array(x.length + y.length - 1).fill(0);

    for (let i = 0; i < x.length; i++) {
        for (let j = 0; j < y.length; j++) {
            const a = rtable[x[i]];
            const b = rtable[y[j]];
            const v = table[(a + b) % 255];
            output[i + j] ^= v;
        }
    }

    while (output.length > 0 && output[0] === 0) output.shift();

    return output;
}

export function add(x: number[], y: number[]) {
    const output: number[] = new Array(Math.max(x.length, y.length)).fill(0);

    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        output[i] = i < x.length ? (i < y.length ? x[i] ^ y[i] : x[i]) : y[i];
    }

    while (output.length > 0 && output[0] === 0) output.shift();

    return output;
}

export function getGeneratorPolynomial(degree: number) {
    let output = [1];
    for (let i = 0; i < degree; i++) {
        output = multiply(output, [1, table[i]]);
    }
    return output;
}
