import { useEffect, useRef } from "react";
import { formatStrings, versionInformation, versionStrings } from "../lib/data";

type Matrix = {
    stages: [string, number[][]][];
    final: number[][];
};

export function useQRMatrix(
    version: number,
    level: string,
    data: string,
): Matrix {
    const info = versionInformation[`${version}-${level}`];
    const stages: [string, number[][]][] = [];

    const size = info.sideLength;

    const getGrid = () =>
        new Array(version * 4 + 17)
            .fill(0)
            .map((_) => new Array(version * 4 + 17).fill(-1));

    const final = getGrid();

    function draw(
        grid: number[][],
        color: number,
        x: number,
        y: number,
        w?: number,
        h?: number,
    ) {
        for (
            let i = Math.max(x, 0);
            i < Math.min(x + (w ?? 1), grid.length);
            i++
        ) {
            for (
                let j = Math.max(y, 0);
                j < Math.min(y + (h ?? 1), grid.length);
                j++
            ) {
                grid[i][j] = final[i][j] = color;
            }
        }
    }

    stages.push([
        "finders",
        (() => {
            const grid = getGrid();

            for (const [x, y] of [
                [0, 0],
                [size - 7, 0],
                [0, size - 7],
            ]) {
                draw(grid, 0, x - 1, y - 1, 9, 9);
                draw(grid, 1, x, y, 7, 7);
                draw(grid, 0, x + 1, y + 1, 5, 5);
                draw(grid, 1, x + 2, y + 2, 3, 3);
            }

            return grid;
        })(),
    ]);

    stages.push([
        "timing",
        (() => {
            const grid = getGrid();

            for (let k = 8; k < size - 8; k++) {
                draw(grid, 1 - (k % 2), k, 6);
                draw(grid, 1 - (k % 2), 6, k);
            }

            return grid;
        })(),
    ]);

    stages.push([
        "alignment",
        (() => {
            const grid = getGrid();

            for (const x of info.alignmentPositions) {
                for (const y of info.alignmentPositions) {
                    if (
                        (x === info.alignmentPositions[0] &&
                            (y === info.alignmentPositions[0] ||
                                y === info.alignmentPositions.at(-1))) ||
                        (x === info.alignmentPositions.at(-1) &&
                            y === info.alignmentPositions[0])
                    )
                        continue;

                    draw(grid, 1, x - 2, y - 2, 5, 5);
                    draw(grid, 0, x - 1, y - 1, 3, 3);
                    draw(grid, 1, x, y);
                }
            }

            return grid;
        })(),
    ]);

    stages.push([
        "reserve-format",
        (() => {
            const grid = getGrid();

            draw(grid, 2, 0, 8, 6, 1);
            draw(grid, 2, 7, 8);
            draw(grid, 2, 8, 8);
            draw(grid, 2, 8, 7);
            draw(grid, 2, 8, 0, 1, 6);
            draw(grid, 2, 8, size - 7, 1, 7);
            draw(grid, 2, size - 8, 8, 8, 1);

            draw(grid, 1, 8, size - 8);

            return grid;
        })(),
    ]);

    stages.push([
        "version-string",
        (() => {
            const grid = getGrid();

            if (version < 7) return grid;

            const string = versionStrings[version];

            for (let i = 0; i < 18; i++) {
                draw(
                    grid,
                    string[17 - i] === "1" ? 1 : 0,
                    Math.floor(i / 3),
                    size - 11 + (i % 3),
                );

                draw(
                    grid,
                    string[17 - i] === "1" ? 1 : 0,
                    size - 11 + (i % 3),
                    Math.floor(i / 3),
                );
            }

            return grid;
        })(),
    ]);

    stages.push([
        "write-data",
        (() => {
            const grid = getGrid();

            let col = size - 1;
            let direction = -1;
            let offset = 0;
            let row = size - 1;

            for (let index = 0; index < data.length; ) {
                if (final[col + offset][row] === -1)
                    draw(
                        grid,
                        data[index++] === "1" ? 1 : 0,
                        col + offset,
                        row,
                    );

                if (offset === 0) offset = -1;
                else {
                    offset = 0;
                    row += direction;

                    if (row < 0 || row >= size) {
                        direction = -direction;
                        row += direction;
                        col -= 2;

                        if (col === 6) col--;
                    }
                }
            }

            return grid;
        })(),
    ]);

    return { stages, final };
}

export function useMasked(matrix: Matrix, level: string, mask: number) {
    const dataMatrix = matrix.stages.find(
        ([name]) => name === "write-data",
    )![1];

    const output = matrix.final.map((row) => new Array(...row));

    for (let col = 0; col < output.length; col++) {
        for (let row = 0; row < output.length; row++) {
            if (dataMatrix[col][row] === -1) continue;

            const masked = [
                (row + col) % 2 === 0,
                row % 2 === 0,
                col % 3 === 0,
                (row + col) % 3 === 0,
                (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
                ((row * col) % 2) + ((row * col) % 3) === 0,
                (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
                (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
            ][mask];

            if (masked) output[col][row] = 1 - output[col][row];
        }
    }

    const formatString = [...formatStrings[level][mask]].map((x) =>
        x === "1" ? 1 : 0,
    );

    for (let i = 0; i < 6; i++)
        output[i][8] = output[8][output.length - i - 1] = formatString[i];

    output[7][8] = output[8][output.length - 7] = formatString[6];
    output[8][8] = output[output.length - 8][8] = formatString[7];
    output[8][7] = output[output.length - 7][8] = formatString[8];

    for (let i = 0; i < 6; i++)
        output[8][i] = output[output.length - i - 1][8] = formatString[14 - i];

    return output;
}

export function QRImage({
    matrix,
    stage,
}: {
    matrix: Matrix | number[][];
    stage?: string;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);

    const stages = Array.isArray(matrix) ? [["", matrix]] : matrix.stages;

    const size = stages.length === 0 ? 0 : stages[0][1].length;

    useEffect(() => {
        const ctx = canvas.current?.getContext("2d");
        if (!ctx) return;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, (size + 8) * 16, (size + 8) * 16);
        ctx.fillStyle = "#000000";

        ctx.save();

        ctx.translate(64, 64);
        ctx.scale(16, 16);

        const final = new Array(size)
            .fill(0)
            .map((_) => new Array(size).fill(-1));

        for (const [name, grid] of stages) {
            for (let i = 0; i < size; i++)
                for (let j = 0; j < size; j++)
                    if (grid[i][j] !== -1) final[i][j] = grid[i][j];

            if (name === stage) break;
        }

        for (let i = 0; i < size; i++)
            for (let j = 0; j < size; j++) {
                ctx.fillStyle = ["#aaaaaa", "#ffffff", "#111111", "#5555ff"][
                    final[i][j] + 1
                ];

                ctx.fillRect(i, j, 1, 1);
            }

        ctx.restore();
    }, [stages, stage]);

    return (
        <center>
            <canvas
                ref={canvas}
                width={(size + 8) * 16}
                height={(size + 8) * 16}
                style={{ width: "calc(max(400px, 60%))", aspectRatio: "1 / 1" }}
            />
        </center>
    );
}
