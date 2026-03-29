"use client";

import {
    Fragment,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from "react";
import { getRemainderBits, versionInformation } from "../lib/data";
import {
    add,
    getGeneratorPolynomial,
    multiply,
    rtable,
    table,
} from "../lib/math";
import { QRImage, useMasked, useQRMatrix } from "./QRImage";

const alphanumericTable = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

export function Main() {
    const ref = useRef<HTMLInputElement>(null);

    const [input, setInput] = useSearchState("input", "", (x) => true);
    const [level, setLevel] = useSearchState("level", "M", (x) =>
        ["L", "M", "Q", "H"].includes(x),
    );
    const [minVersion, setMinVersion] = useSearchState(
        "min-version",
        "1",
        (x) => /^([1-9]|[1-4][0-9])$/.test(x),
    );
    const [mask, setMask] = useState(0);

    const mode = /^[0-9]*$/.test(input)
        ? "numeric"
        : /^[0-9A-Z $%*+\-\.\/:]*$/.test(input)
          ? "alphanumeric"
          : "UTF-8";

    const encoded = useMemo(() => {
        if (mode === "numeric") {
            return input.replace(/\d{1,3}/g, (x) =>
                (+x).toString(2).padStart(x.length * 3 + 1, "0"),
            );
        } else if (mode === "alphanumeric") {
            return input.replace(/.{1,2}/g, (x) =>
                [...x]
                    .map((c) => alphanumericTable.indexOf(c))
                    .reduce((x, y) => x * 45 + y, 0)
                    .toString(2)
                    .padStart(x.length * 5 + 1, "0"),
            );
        } else if (mode === "UTF-8") {
            return [...input]
                .map((c) => encodeUTF8(c.codePointAt(0)!))
                .join("")
                .replace(/[^01]/g, "");
        } else return "";
    }, [input, mode]);

    const maxCodePointLength = [...input]
        .reduce((x, y) => Math.max(x, y.codePointAt(0)!), 0)
        .toString().length;

    const version = useMemo(() => {
        let version = Math.max(/^\d+$/.test(minVersion) ? +minVersion : 1, 1);

        while (true) {
            if (version > 40) {
                version = -1;
                break;
            }

            const total =
                4 + getCharCountLength(version, mode) + encoded.length;

            if (
                total >
                versionInformation[`${version}-${level}`].totalCodewords * 8
            )
                version++;
            else break;
        }

        return version;
    }, [minVersion, input, mode, level]);

    const versionInfo = versionInformation[`${version}-${level}`];

    const charCountLength = getCharCountLength(version, mode);
    const capacity = versionInfo.totalCodewords * 8;
    const prePadLength = 4 + charCountLength + encoded.length;

    const modeIndicator =
        mode === "numeric"
            ? "0001"
            : mode === "alphanumeric"
              ? "0010"
              : mode === "UTF-8"
                ? "0100"
                : "????";

    const charCountIndicator = (
        mode === "UTF-8" ? encoded.length / 8 : input.length
    )
        .toString(2)
        .padStart(charCountLength, "0");

    const fullBitArray = useMemo(() => {
        let array = "";
        array += modeIndicator;
        array += charCountIndicator;
        array += encoded;
        if (array.length < capacity)
            array += "0".repeat(Math.min(capacity - array.length, 4));
        array += "0".repeat((8 - ((array.length - 8) % 8)) % 8);

        let addon = 236;
        while (array.length < capacity) {
            array += addon.toString(2).padStart(8, "0");
            addon = 253 - addon;
        }

        array = array.replace(/\d{8}(?!$)/g, (x) => x + " ");

        return array;
    }, [version, input, mode, level]);

    const bytes = fullBitArray.split(" ");

    const [groupOne, groupTwo] = useMemo(() => {
        const groupOne: string[][] = [];
        const groupTwo: string[][] = [];

        const copy = bytes.map((x) => x);

        for (let i = 0; i < versionInfo.groupOneBlocks; i++)
            groupOne.push(copy.splice(0, versionInfo.groupOneBlockSize));

        for (let i = 0; i < versionInfo.groupTwoBlocks; i++)
            groupTwo.push(copy.splice(0, versionInfo.groupTwoBlockSize));

        return [groupOne, groupTwo];
    }, [bytes, versionInfo]);

    const generatorPolynomial = useMemo(
        () => getGeneratorPolynomial(versionInfo.errorWordsPerBlock),
        [versionInfo],
    );

    const blockPolynomials = useMemo(
        () =>
            [groupOne, groupTwo].map((group) =>
                group.map((block) => block.map((byte) => parseInt(byte, 2))),
            ),
        [groupOne, groupTwo],
    );

    const errorCorrectionCalculations = useMemo(() => {
        return blockPolynomials.map((block) =>
            block.map((input) => {
                const results: [number[], number[], number[]][] = [];

                const initial = multiply(input, [
                    1,
                    ...new Array(generatorPolynomial.length - 1).fill(0),
                ]);

                let poly = initial;

                while (poly.length >= generatorPolynomial.length) {
                    const factor: number[] = [
                        table[
                            (rtable[poly[0]] -
                                rtable[generatorPolynomial[0]] +
                                255) %
                                255
                        ],
                        ...new Array(
                            poly.length - generatorPolynomial.length,
                        ).fill(0),
                    ];

                    const subtrahend = multiply(factor, generatorPolynomial);
                    poly = add(poly, subtrahend);

                    results.push([factor, subtrahend, poly]);
                }

                return { initial, results, poly };
            }),
        );
    }, [blockPolynomials, generatorPolynomial]);

    const errorsPerBlock = errorCorrectionCalculations.map((group) =>
        group.map((block) => block.poly),
    );

    const finalOutput = useMemo(() => {
        const codewords: number[] = [];
        const blocks = [...groupOne, ...groupTwo];
        const errors = errorsPerBlock.flat(1);

        for (
            let i = 0;
            i < Math.max(...blocks.map((block) => block.length));
            i++
        ) {
            codewords.push(
                ...blocks
                    .filter((block) => i < block.length)
                    .map((block) => parseInt(block[i], 2)),
            );
        }

        for (
            let i = 0;
            i < Math.max(...errors.map((block) => block.length));
            i++
        ) {
            codewords.push(
                ...errors
                    .filter((block) => i < block.length)
                    .map((block) => block[i]),
            );
        }

        return (
            codewords.map((x) => x.toString(2).padStart(8, "0")).join("") +
            "0".repeat(getRemainderBits(version))
        );
    }, [groupOne, groupTwo, errorsPerBlock, version]);

    const matrix = useQRMatrix(version, level, finalOutput);

    const masked = useMemo(
        () =>
            new Array(8)
                .fill(0)
                .map((_, index) => useMasked(matrix, level, index)),
        [matrix, level],
    );

    const penalties = useMemo(
        () =>
            masked.map((grid) => {
                let colPenalty = 0;

                for (const col of grid) {
                    let last = -1;
                    let streak = 0;

                    for (const cell of col) {
                        if (last === cell) streak++;
                        else {
                            last = cell;
                            streak = 1;
                        }

                        if (streak >= 5) colPenalty++;
                    }
                }

                let rowPenalty = 0;

                for (let row = 0; row < grid.length; row++) {
                    let last = -1;
                    let streak = 0;

                    for (let col = 0; col < grid.length; col++) {
                        const cell = grid[col][row];

                        if (last === cell) streak++;
                        else {
                            last = cell;
                            streak = 1;
                        }

                        if (streak >= 5) rowPenalty++;
                    }
                }

                let blockPenalty = 0;

                for (let row = 0; row < grid.length - 1; row++) {
                    for (let col = 0; col < grid.length - 1; col++) {
                        if (
                            grid[col][row] === grid[col][row + 1] &&
                            grid[col][row] === grid[col + 1][row] &&
                            grid[col][row] === grid[col + 1][row + 1]
                        )
                            blockPenalty += 3;
                    }
                }

                let colFinderPenalty = 0;

                for (const col of grid) {
                    for (let row = 0; row < grid.length - 10; row++) {
                        const pattern = col.slice(row, row + 11).join("");

                        if (
                            pattern === "10111010000" ||
                            pattern === "00001011101"
                        )
                            colFinderPenalty += 40;
                    }
                }

                let rowFinderPenalty = 0;

                for (let i = 0; i < grid.length; i++) {
                    const row = grid.map((col) => col[i]);
                    for (let col = 0; col < grid.length - 10; col++) {
                        const pattern = row.slice(col, col + 11).join("");

                        if (
                            pattern === "10111010000" ||
                            pattern === "00001011101"
                        )
                            rowFinderPenalty += 40;
                    }
                }

                let ratioPenalty = 0;

                const total = grid.length * grid.length;
                const dark = grid.reduce(
                    (x, y) => x + y.reduce((x, y) => x + y, 0),
                    0,
                );

                const ratio = (dark / total) * 100;
                const lower = Math.abs(Math.floor(ratio / 5) * 5 - 50) / 5;
                const upper = Math.abs(Math.ceil(ratio / 5) * 5 - 50) / 5;
                ratioPenalty += Math.min(lower, upper) * 10;

                return {
                    rowPenalty,
                    colPenalty,
                    blockPenalty,
                    rowFinderPenalty,
                    colFinderPenalty,
                    ratioPenalty,
                    total:
                        rowPenalty +
                        colPenalty +
                        blockPenalty +
                        rowFinderPenalty +
                        colFinderPenalty +
                        ratioPenalty,
                };
            }),
        [masked],
    );

    const penaltyTotals = penalties.map((p) => p.total);
    const bestMask = penaltyTotals.indexOf(Math.min(...penaltyTotals));

    return (
        <>
            <div className="container" style={{ paddingBottom: "12rem" }}>
                <span></span>
                <h1 id="top">HyperNeutrino's QR Code Tool</h1>
                <p>
                    Welcome to my QR code tool! All of the code here is under
                    the MIT license. This is an educational resource, so feel
                    free to use its code however you want and use it to learn
                    about how the encoding behind QR codes works.
                </p>
                <p>
                    <b>Disclaimer:</b> I make no guarantees that QR codes
                    produced by this website are accurate or functional.
                    Validate QR codes before using them and use at your own
                    risk.
                </p>
                <hr />
                <h2 id="section-1">
                    <a href="#section-1">[#]</a> Section I: Input
                </h2>
                <p>
                    Input the data (this can be a URL or any text) to encode
                    below. Select an error correction level (refer to the below
                    table). Select the QR code version (higher version =
                    larger). If the version selected is too small to encode your
                    data, the appropriate version will be used. Select a masking
                    pattern (recommended to set to automatic unless you want to
                    test a specific one).
                </p>
                <table>
                    <tbody>
                        <tr>
                            <th>Level</th>
                            <th>Notes</th>
                        </tr>
                        <tr>
                            <td>Low (L)</td>
                            <td>Recovers ~7% corruption</td>
                        </tr>
                        <tr>
                            <td>Medium (M)</td>
                            <td>Recovers ~15% corruption</td>
                        </tr>
                        <tr>
                            <td>Quartile (Q)</td>
                            <td>Recovers ~25% corruption</td>
                        </tr>
                        <tr>
                            <td>High (H)</td>
                            <td>Recovers ~30% corruption</td>
                        </tr>
                    </tbody>
                </table>
                <div className="label-grid">
                    <label htmlFor="input-string">
                        <b>Input String:</b>
                    </label>
                    <input
                        type="text"
                        id="input-string"
                        value={input}
                        onInput={(e) => setInput(e.currentTarget.value)}
                    />
                    <label htmlFor="level">
                        <b>Error Correction:</b>
                    </label>
                    <div>
                        <select
                            id="level"
                            value={level}
                            onInput={(e) => setLevel(e.currentTarget.value)}
                        >
                            <option value="L">Low</option>
                            <option value="M">Medium</option>
                            <option value="Q">Quartile</option>
                            <option value="H">High</option>
                        </select>
                    </div>
                    <label htmlFor="version">
                        <b>Version:</b>
                    </label>
                    <input
                        type="number"
                        id="version"
                        value={minVersion}
                        onInput={(e) => setMinVersion(e.currentTarget.value)}
                        min={1}
                        max={40}
                    />
                </div>
                <p>
                    <a href="#result">[Jump to Result]</a>
                </p>
                <hr />
                <h2 id="section-2">
                    <a href="#section-2">[#]</a> Section II: Data Encoding
                </h2>
                <p>
                    QR codes are representations of bit arrays, so we need to
                    convert our input characters into a bit array. The simplest
                    way to do this is to pick a character set that includes all
                    of the input characters and encode the whole string
                    according to that. It is possible to optimize further by
                    mixing encoding modes, but this tool will not implement that
                    for simplicity.
                </p>
                <p>
                    Now, we encode our input into a bit array. The mode required
                    for your input is {mode}.
                </p>
                {mode === "numeric" ? (
                    <>
                        <p>
                            For numeric encoding, we split our input into
                            three-digit chunks (if the input length is not a
                            multiple of three, the last group is simply smaller)
                            and then encode each chunk into 10 bits (or 7 or 4
                            for the last group if it is only 2 or 1 digits
                            long).
                        </p>
                        <pre>
                            {(input.match(/\d{1,3}/g) ?? []).map((x, index) => (
                                <Fragment key={index}>
                                    {x.padStart(3, " ")} &rarr;{" "}
                                    {(+x)
                                        .toString(2)
                                        .padStart(x.length * 3 + 1, "0")}
                                    <br />
                                </Fragment>
                            ))}
                        </pre>
                    </>
                ) : null}
                {mode === "alphanumeric" ? (
                    <>
                        <p>
                            For alphanumeric encoding, we split our input into
                            pairs of characters (if the input length is odd, the
                            last chunk is just one character). Then, we encode
                            each character to a number (<code>0–9</code> becomes{" "}
                            <code>0–9</code>, <code>A–Z</code>
                            becomes <code>10–35</code>, <code>space</code> is{" "}
                            <code>36</code>, and <code>$</code>, <code>%</code>,{" "}
                            <code>*</code>, <code>+</code>, <code>-</code>,{" "}
                            <code>.</code>, <code>/</code>, and <code>:</code>{" "}
                            follow up to 44).
                        </p>
                        <p>
                            Next, we multiply the first number by 45 and add the
                            second number (basically, we use base 45) and encode
                            it into an 11-digit binary number. If the final
                            digit is alone, it becomes a 6-digit binary number.
                        </p>
                        <pre>
                            {(input.match(/.{1,2}/g) ?? []).map((x, index) => (
                                <Fragment key={index}>
                                    {x.padStart(2, " ")} &rarr;{" "}
                                    {[...x]
                                        .map((c) =>
                                            alphanumericTable
                                                .indexOf(c)
                                                .toString()
                                                .padStart(2, " "),
                                        )
                                        .join(" ")
                                        .padStart(5, " ")}{" "}
                                    &rarr;{" "}
                                    {[...x]
                                        .map((c) =>
                                            alphanumericTable.indexOf(c),
                                        )
                                        .reduce((x, y) => x * 45 + y, 0)
                                        .toString(2)
                                        .padStart(x.length * 5 + 1, "0")}
                                    <br />
                                </Fragment>
                            ))}
                        </pre>
                    </>
                ) : null}
                {mode === "UTF-8" ? (
                    <>
                        <p>
                            For UTF-8 encoding, we just convert our string to
                            binary using UTF-8.
                        </p>
                        <pre>
                            {[...input].map((c, index) => {
                                const cp = c.codePointAt(0)!;

                                return (
                                    <Fragment key={index}>
                                        {c} &rarr;{" "}
                                        {cp
                                            .toString()
                                            .padStart(
                                                maxCodePointLength,
                                                " ",
                                            )}{" "}
                                        &rarr; {encodeUTF8(cp)}
                                        <br />
                                    </Fragment>
                                );
                            })}
                        </pre>
                    </>
                ) : null}
                <p>This gives us the following final encoded bit array:</p>
                <pre>{encoded}</pre>
                <p>
                    Now, we need to add the encoding information. This depends
                    on our version, which is{" "}
                    {version === -1 ? "larger than possible" : version}.
                </p>
                {version === -1 ? (
                    <p>
                        There is too much input data! This exceeds what is
                        possible to be encoded in a QR code, at least with a
                        single encoding method. If the data contains large
                        blocks of data that can be encoded in a simpler format,
                        then it can probably be optimized with mixed-mode
                        encoding, but this tool does not support that.
                    </p>
                ) : (
                    <>
                        <p>
                            We begin by adding the mode indicator. For {mode},
                            that's <code>{modeIndicator}</code>. Then, we add
                            the character count indicator, which is padded to{" "}
                            {charCountLength} bits, giving us{" "}
                            <code>{charCountIndicator}</code>.
                        </p>
                        <p>
                            Now, we need to pad these bits. The capacity for
                            this version and error correction level is{" "}
                            {versionInfo.totalCodewords} codewords, which is{" "}
                            {capacity} bits. Our string is currently{" "}
                            {prePadLength} bits. Since the difference is{" "}
                            {capacity - prePadLength >= 4
                                ? "4+ bits"
                                : "< 4 bits"}
                            , we add a terminator of{" "}
                            {Math.min(capacity - prePadLength, 4)}{" "}
                            {capacity - prePadLength === 1 ? "zero" : "zeroes"}{" "}
                            to the end. Next, we pad with zeroes until the
                            length is a multiple of 8, adding{" "}
                            {(8 -
                                ((prePadLength +
                                    Math.min(capacity - prePadLength, 4)) %
                                    8)) %
                                8}{" "}
                            {(prePadLength +
                                Math.min(capacity - prePadLength, 4)) %
                                8 ===
                            7
                                ? "bit"
                                : "bits"}
                            . Finally, we pad with{" "}
                            <code>11101100 00010001</code> (<code>236 17</code>)
                            until we reach the required length.
                        </p>
                        <p>This is our final bit array:</p>
                        <pre>{fullBitArray}</pre>
                    </>
                )}
                <hr />
                <h2 id="section-3">
                    <a href="#section-3">[#]</a> Section III: Error-Correction
                    Coding
                </h2>
                <p>
                    In this section, we will generate error-correction codes.
                    These allow a reader to reconstruct damaged or missing parts
                    of a QR code. If you've ever seen a QR code with a logo in
                    the middle, this is how it's done—with a high enough error
                    correction level, you can remove an entire chunk out of the
                    middle and still have it be readable.
                </p>
                <p>
                    Some versions require splitting the codewords into multiple
                    blocks. Error-correcting codes are generated per-block, then
                    the data is interleaved at the end.{" "}
                    {versionInfo.groupOneBlocks > 1 ||
                    versionInfo.groupTwoBlocks > 0
                        ? "This is required for this version, and the division is displayed below."
                        : "This is not required for this version."}
                </p>
                <pre>
                    {[groupOne, groupTwo]
                        .filter((group) => group.length > 0)
                        .map((group, index) => (
                            <Fragment key={index}>
                                Group {index + 1}:
                                <br />
                                {group.map((block, index) => (
                                    <Fragment key={index}>
                                        &nbsp;&nbsp;&nbsp;&nbsp;Block{" "}
                                        {index + 1}:
                                        <br />
                                        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                                        {block[0]} — byte #1
                                        <br />
                                        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;...
                                        <br />
                                        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                                        {block.at(-1)} — byte #{block.length}
                                        <br />
                                    </Fragment>
                                ))}
                            </Fragment>
                        ))}
                </pre>
                <p>
                    Now, we add {versionInfo.errorWordsPerBlock} error words for
                    each block. This explanation won't go into Reed-Solomon
                    codes in depth, but long story short, we convert each block
                    to a polynomial (with coefficients equal to the bytes in the
                    block), obtain a generator polynomial, and find the
                    remainder of dividing the block by the generator. This
                    allows us to use the code polynomial and the remainder, and
                    their difference should be a multiple of the generator, and
                    if it isn't, we can detect and correct errors.
                </p>
                <p>
                    Since we need {versionInfo.errorWordsPerBlock} error words
                    per block, we need a generator polynomial of degree{" "}
                    {versionInfo.errorWordsPerBlock}. We do this by multiplying{" "}
                    <code>
                        (x - &alpha;<sup>0</sup>) (x - &alpha;
                        <sup>1</sup>) &#x22EF; (x - &alpha;
                        <sup>{versionInfo.errorWordsPerBlock - 1}</sup>)
                    </code>{" "}
                    where <code>&alpha; = 2</code>. We're working in the Galois
                    field <code>GF(256)</code>. A Galois field is a field with a
                    finite number of elements. The field used here is the field
                    of integers mod 2 of dimension 8 (
                    <code>
                        2<sup>8</sup> = 256
                    </code>
                    ). All Galois fields of order{" "}
                    <code>
                        2<sup>8</sup>
                    </code>{" "}
                    are isomorphic (basically, you can map their elements
                    one-to-one and have the exact same operations), but in this
                    case, our field will contain the numbers 0 through 255 and
                    use XOR as addition. Note that subtraction is also XOR here,
                    so signs are irrelevant—you'll see the minus signs disappear
                    later. All numbers in{" "}
                    <code>
                        GF(2<sup>8</sup>)
                    </code>
                    , except zero, can be represented as{" "}
                    <code>
                        2<sup>n</sup>
                    </code>
                    , but of course,{" "}
                    <code>
                        2<sup>8</sup> = 256
                    </code>{" "}
                    which is too large. The QR code specification says to modulo
                    all numbers with <code>100011101</code> (using bitwise XOR)
                    if they are too large. Basically, if a number exceeds 255,
                    then it will be 9 bits (no leading zeroes), so we XOR it
                    with 285, which makes the first digit (with place value 256)
                    zero. Since 285 is coprime with 256, this representation
                    will cover all values.
                </p>
                <p>
                    Thus,{" "}
                    <code>
                        &alpha;<sup>8</sup>
                    </code>{" "}
                    is not 256 but rather 29.{" "}
                    <code>
                        &alpha;<sup>9</sup>
                    </code>{" "}
                    is not calculated by taking <code>512 &#x2A01; 285</code>{" "}
                    but instead by doing{" "}
                    <code>
                        &alpha;<sup>9</sup> = &alpha; &times; &alpha;
                        <sup>8</sup>
                    </code>{" "}
                    (and then taking the bitwise modulo 285 if needed).
                </p>
                <p>Our generator polynomial in this case will be:</p>
                <pre>
                    &nbsp;&nbsp;(x - &alpha;<sup>0</sup>) (x - &alpha;
                    <sup>1</sup>) &#x22EF; (x - &alpha;
                    <sup>{versionInfo.errorWordsPerBlock - 1}</sup>)
                    <br />= (&alpha;<sup>0</sup>x - &alpha;<sup>0</sup>)
                    (&alpha;<sup>0</sup>x - &alpha;
                    <sup>1</sup>) &#x22EF; (&alpha;<sup>0</sup>x - &alpha;
                    <sup>{versionInfo.errorWordsPerBlock - 1}</sup>)
                    <br />= &alpha;<sup>0</sup>x
                    <sup>{versionInfo.errorWordsPerBlock}</sup> + (&alpha;
                    <sup>1</sup> + &#x22EF; + &alpha;
                    <sup>{versionInfo.errorWordsPerBlock}</sup>)x
                    <sup>{versionInfo.errorWordsPerBlock - 1}</sup> + &#x22EF; +
                    &alpha;<sup>0</sup>&alpha;<sup>1</sup>&#x22EF;&alpha;
                    <sup>{versionInfo.errorWordsPerBlock - 1}</sup>
                    <br />={" "}
                    <DisplayPolynomial alpha poly={generatorPolynomial} />
                </pre>
                <p>
                    Now, we'll get the error correction codes for each block.
                    Only block 1 is displayed below.
                </p>
                <p>The polynomial for this block is:</p>
                <pre>
                    <DisplayPolynomial poly={blockPolynomials[0][0]} />
                </pre>
                <p>In &alpha;-notation, that's:</p>
                <pre>
                    <DisplayPolynomial alpha poly={blockPolynomials[0][0]} />
                </pre>
                <p>
                    To get the remainder, we'll do polynomial division. As
                    usual, we multiply the divisor by the appropriate polynomial
                    such that it can be subtracted from the dividend and cancel
                    out the first term. Since we're in <code>GF(256)</code>, we
                    will never get fractional coefficients—if the leading term
                    of our code polynomial is{" "}
                    <code>
                        &alpha;<sup>p</sup>
                    </code>{" "}
                    and the leading term of our generator polynomial is{" "}
                    <code>
                        &alpha;<sup>q</sup>
                    </code>
                    , then we can just multiply the generator by{" "}
                    <code>
                        &alpha;<sup>p - q</sup>
                    </code>{" "}
                    (multiplied by the appropriate <code>x</code> term).
                </p>
                <p>
                    To ensure we have enough data for the remainder, we'll
                    multiply the block's polynomial by{" "}
                    <code>
                        x<sup>{versionInfo.errorWordsPerBlock}</sup>
                    </code>
                    .
                </p>
                <p>Therefore, we start with this polynomial:</p>
                <pre>
                    <DisplayPolynomial
                        alpha
                        poly={errorCorrectionCalculations[0][0].initial}
                    />
                </pre>
                <p>
                    Now, we find the factor <code>F</code> such that{" "}
                    <code>F</code> multiplied by the generator polynomial
                    cancels out the first term of the polynomial.
                </p>
                <pre>
                    F ={" "}
                    <DisplayPolynomial
                        alpha
                        poly={errorCorrectionCalculations[0][0].results[0][0]}
                    />
                </pre>
                <p>
                    Consequently, we subtract <code>F &times; G</code> from our
                    polynomial to get:
                </p>
                <pre>
                    &nbsp;&nbsp;P - F &times; G
                    <br />
                    <br />={" "}
                    <DisplayPolynomial
                        alpha
                        poly={errorCorrectionCalculations[0][0].results[0][2]}
                    />
                    <br />
                    <br />={" "}
                    <DisplayPolynomial
                        poly={errorCorrectionCalculations[0][0].results[0][2]}
                    />
                </pre>
                <p>
                    We've reduced the degree of our polynomial. We repeat this
                    step over and over until finally, our polynomial has a
                    degree less than the generator polynomial (divisor) and
                    therefore have the remainder. This gives us our final
                    answer:
                </p>
                <pre>
                    <DisplayPolynomial
                        poly={errorCorrectionCalculations[0][0].poly}
                    />
                </pre>
                <p>
                    We then take the coefficients of this polynomial, giving us
                    the error-correction code for this block:
                </p>
                <pre>
                    {errorCorrectionCalculations[0][0].poly
                        .map((x) => x.toString(2).padStart(8, "0"))
                        .join(" ")}
                </pre>
                <h2 id="section-4">
                    <a href="#section-4">[#]</a> Section IV: Structure Message
                    Bytes
                </h2>
                {versionInfo.groupOneBlocks === 1 &&
                versionInfo.groupTwoBlocks === 0 ? (
                    <>
                        <p>
                            Since there is only one block, the final output is
                            just the data codewords followed by the error
                            codewords.
                        </p>
                    </>
                ) : (
                    <>
                        <p>
                            Since there is more than one block, the final output
                            needs to be interleaved. We take the first codeword
                            of the first block, then the first codeword of the
                            second block, and so on for each block. Then, we add
                            on the second codeword of each block, then the
                            third, etc. Afterwards, we do the same for the error
                            codewords per block.
                        </p>
                    </>
                )}
                <p>
                    Version {version} requires {getRemainderBits(version)}{" "}
                    remainder bits to be added at the end (the number of data
                    bits available in the QR code may not be a multiple of 8).
                </p>
                <p>Here's the final output:</p>
                <pre>{finalOutput.replace(/\d{1,8}/g, (x) => x + " ")}</pre>
                <h2 id="section-5">
                    <a href="#section-5">[#]</a> Section V: Module Placement
                </h2>
                <p>
                    A module refers to the smallest unit in a QR code (a 1x1
                    square). Let's start placing modules on our QR code. There
                    are several function patterns in a QR code which must be
                    placed in specific places so that QR code scanners can read
                    the code.
                </p>
                <p>
                    The most obvious of these are the finder patterns, which are
                    the 3x3 squares with a 1-wide ring around them in the
                    top-left, bottom-left, and top-right corners. These are used
                    by the scanner to find the QR code and identify its
                    position, rotation, and scale.
                </p>
                <p>
                    Let's start with that. Note that the standard calls for a
                    4-wide zone around the QR code to help scanners identify the
                    code. Each finder pattern also has a 1-wide whitespace
                    around it to keep it separate from everything else.
                </p>
                <QRImage matrix={matrix} stage="finders" />
                <p>
                    Next, we add timing patterns. The seventh row and column of
                    all QR codes alternate between white and black in between
                    the finder patterns (these are in alignment with the bottom
                    row and right column of the top-left finder pattern). This
                    is used by the scanner to determine the size/version of the
                    QR code and align rows and columns in case of warping.
                </p>
                <QRImage matrix={matrix} stage="timing" />
                {version === 1 ? (
                    <p>
                        Normally, we would add alignment patterns, but those are
                        only required for version 2+, so we skip this step here.
                    </p>
                ) : (
                    <>
                        <p>
                            Next, we add alignment patterns. You may recognize
                            these—these are the 5x5 squares containing a ring
                            with a 1x1 in the middle which appear in a grid
                            pattern. These are placed in a grid with the
                            left-most and top-most instances aligning (centered)
                            with the timing patterns and the right-most and
                            bottom-most instances aligning (centered) with the
                            left/top edge of the right/bottom finder patterns.
                        </p>
                        <p>
                            The "side length" of the grid of alignment patterns
                            is{" "}
                            <code>
                                &lfloor; version &divide; 7 &rfloor; + 2 ={" "}
                                {Math.floor(version / 7) + 2}
                            </code>
                            , so we place{" "}
                            {(Math.floor(version / 7) + 2) ** 2 - 3} pattern
                            {Math.floor(version / 7) === 0 ? "" : "s"}. We do
                            not place the top-left, bottom-left, or top-right
                            patterns because they would intersect with the
                            finder patterns which is not allowed. Note that
                            there is no conflict with the timing patterns
                            because they always line up.
                        </p>
                        <p>
                            We distribute these patterns as evenly as we can.
                            The distance is the range between the left-most and
                            right-most pattern divided by one less than the
                            alignment count, rounded up to the nearest even
                            number. If this is not a perfect distribution, we
                            place the middle alignment patterns based on the
                            right/bottom alignment and place the top/left
                            patterns separately.
                        </p>
                        <QRImage matrix={matrix} stage="alignment" />
                    </>
                )}
                <p>
                    Next, let's reserve format and version information modules.
                    The 1-wide strip around the top-left finder pattern stores a
                    15-bit string indicating the error correction level and
                    masking pattern (we'll talk about this later). The column to
                    the right of the bottom-left finder and the row beneath the
                    top-right finder duplicates this information. Also, the
                    square to the right of the top of the padding around the
                    bottom-left finder is always a dark module.
                </p>
                <QRImage matrix={matrix} stage="reserve-format" />
                {version >= 7 ? (
                    <>
                        <p>
                            The version string encodes the version. For larger
                            codes, getting the width and height from the timing
                            patterns can be unreliable, so we also encode what
                            the version actually is above the bottom-left finder
                            and to the left of the top-right finder. This
                            applies for versions 7+ which can be easily
                            identified as that is the first version with more
                            than one alignment pattern.
                        </p>
                        <p>
                            The version string is 18 bits and is written
                            top-to-bottom then left-to-right in the bottom-left
                            instance and left-to-right then top-to-bottom in the
                            other one. We start with the version number as a
                            6-bit binary string, then use the generator
                            polynomial{" "}
                            <code>
                                <DisplayPolynomial
                                    poly={[
                                        1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1,
                                    ]}
                                />
                            </code>{" "}
                            to get a 12-bit error correction code. Again, we can
                            use a lookup table for this.
                        </p>
                        <p>
                            Note that the version string is written with the
                            least-significant-bit first.
                        </p>
                        <QRImage matrix={matrix} stage="version-string" />
                    </>
                ) : (
                    <p>
                        For versions 7+, we need to include a version string,
                        but that does not apply here, so we skip that step.
                    </p>
                )}
                <p>
                    This concludes the fixed/reserved information. Now, we can
                    begin writing the data. We go right-to-left, two columns at
                    a time, alternating going up and down each pair of columns.
                    We write in a zig-zag pattern, always writing to the right
                    column before the left column in the same row. If we run
                    into patterns or reserved sections, we just skip those
                    modules and keep going in the next available module.
                </p>
                <p>
                    The exception is column 7, which is skipped because it is
                    the timing pattern. The last six columns are always written
                    down, up, then down.
                </p>
                <QRImage matrix={matrix} stage="write-data" />
                <h2 id="section-6">
                    <a href="#section-6">[#]</a> Section VI: Masking
                </h2>
                <p>
                    Now that we've placed the modules, we need to apply a
                    masking pattern. There are 8 possible masking patterns. A
                    masking pattern inverts certain modules depending on their
                    row/column position and their purpose is to break up blocks
                    that are difficult for QR code scanners to read or prone to
                    errors.
                </p>
                <p>
                    At the same time, we need to go over format and version
                    information, because the information sections are included
                    in the penalty calculations but excluded from the masking
                    (we do not modify any of the function patterns with the mask
                    as they need to be intact for the reader to understand
                    them).
                </p>
                <p>
                    The format string encodes the error correction level and
                    mask pattern. This string is always 15 bits long and is
                    stored in the 1-wide strip around the top-left finder and
                    duplicated across the other two finders. We start with two
                    bits for the error correction level: <code>01</code> for
                    low, <code>00</code> for medium, <code>11</code> for
                    quartile, and <code>10</code> for high (note that these are
                    not in order). Then, we include the mask pattern (
                    <code>0–7</code>) as a 3-bit binary string.
                </p>
                <p>
                    Now that we have 5 bits, the specification calls for the
                    generator polynomial{" "}
                    <code>
                        <DisplayPolynomial
                            poly={[1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1]}
                        />
                    </code>
                    . Since there are only 32 possibilities, we can just use a
                    lookup table to get the 15-bit format string for our error
                    correction level and mask pattern.
                </p>
                <p>
                    We find the optimal mask pattern by trying all of them and
                    calculating a penalty for each. You can scroll through all
                    of the options below. If you want to use a specific mask
                    pattern, you can save that image.
                </p>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                        }}
                    >
                        {new Array(8).fill(0).map((_, index) => (
                            <button key={index} onClick={() => setMask(index)}>
                                {index}
                            </button>
                        ))}
                    </div>
                </div>
                <h3>Mask Pattern {mask}</h3>
                <QRImage matrix={masked[mask]} />
                <center>
                    <p>Penalty: {penalties[mask].total}</p>
                </center>
                <p>The penalty is calculated by summing these values:</p>
                <ul>
                    <li>
                        For each run of 5+ modules with the same color in a row,
                        add 1 plus the number of modules in excess of 5 (in this
                        case, {penalties[mask].rowPenalty}).
                    </li>
                    <li>
                        We do the same for columns ({penalties[mask].colPenalty}
                        ).
                    </li>
                    <li>
                        Next, for each 2&times;2 block of modules with the same
                        color (counting overlaps), we add a penalty of 3 (
                        {penalties[mask].blockPenalty}).
                    </li>
                    <li>
                        The finder patterns are important and anything that
                        could confuse the reader as to where they are is heavily
                        penalized. Any sequence of 11 modules in a row that
                        matches <code>10111010000</code> or{" "}
                        <code>00001011101</code> gains a penalty of 40 (
                        {penalties[mask].rowFinderPenalty}).
                    </li>
                    <li>
                        Again, we do the same for columns (
                        {penalties[mask].colFinderPenalty}).
                    </li>
                    <li>
                        Finally, we take the proportion of dark modules to total
                        modules, find the nearest multiple of 5 below/equal to
                        and above/equal to it, take the absolute difference of
                        each with 50, take the lesser of the two, and double it
                        ({penalties[mask].ratioPenalty}).
                    </li>
                </ul>
                <p>
                    The optimal pattern is {bestMask}. Here is the final result:
                </p>
                <QRImage matrix={masked[bestMask]} />
                <p>
                    <a href="#top" id="result">
                        [Jump to Top]
                    </a>
                </p>
            </div>
        </>
    );
}

function DisplayPolynomial({
    poly,
    alpha,
}: {
    poly: number[];
    alpha?: boolean;
}) {
    return poly.map((coeff, index) =>
        coeff === 0 ? null : (
            <Fragment key={index}>
                {index === 0 ? null : <> + </>}
                {alpha ? (
                    <>
                        &alpha;<sup>{rtable[coeff]}</sup>
                    </>
                ) : coeff === 1 && index !== poly.length - 1 ? (
                    ""
                ) : (
                    coeff
                )}
                {poly.length - 1 - index === 0 ? "" : "x"}
                {poly.length - 1 - index < 2 ? null : (
                    <sup>{poly.length - 1 - index}</sup>
                )}
            </Fragment>
        ),
    );
}

function useSearchState(
    name: string,
    defaultValue: string,
    validator: (fn: string) => boolean,
): [string, Dispatch<SetStateAction<string>>] {
    const [value, setValue] = useState(defaultValue);

    useEffect(() => {
        const newValue =
            new URLSearchParams(window.location.search).get(name) ??
            defaultValue;

        setValue(validator(newValue) ? newValue : defaultValue);
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        params.set(name, value);
        window.history.replaceState({}, "", `?${params.toString()}`);
    }, [value]);

    return [value, setValue];
}

function encodeUTF8(cp: number) {
    return cp <= 0x7f
        ? cp.toString(2).padStart(8, "0")
        : cp <= 0x7ff
          ? cp
                .toString(2)
                .padStart(11, "0")
                .replace(/^\d{5}/, (x) => "110" + x + " 10")
          : cp <= 0xffff
            ? "1110" +
              cp
                  .toString(2)
                  .padStart(16, "0")
                  .replace(/^\d{4}/, (x) => x + " 10")
                  .replace(/ 10\d{6}/, (x) => x + " 10")
            : "11110" +
              cp
                  .toString(2)
                  .padStart(21, "0")
                  .replace(/^\d{3}/, (x) => x + " 10")
                  .replace(/ 10\d{6}/, (x) => x + " 10")
                  .replace(/( 10\d{6}){2}/, (x) => x + " 10");
}

function getCharCountLength(version: number, mode: string) {
    const category = version <= 9 ? 1 : version <= 26 ? 2 : 3;

    return mode === "numeric"
        ? category * 2 + 8
        : mode === "alphanumeric"
          ? category * 2 + 7
          : mode === "UTF-8"
            ? version <= 9
                ? 8
                : 16
            : 0;
}
