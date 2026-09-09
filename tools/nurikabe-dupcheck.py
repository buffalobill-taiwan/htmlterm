#!/usr/bin/env python3
"""
nurikabe-dupcheck — Check a Nurikabe board for duplicate solutions.

An independent solver (Google OR-Tools CP-SAT) that answers whether a Nurikabe
puzzle admits more than one valid solution. Unlike the generator's single-swap
rigidity check (js/util/nurikabe-engine.js, islandSwapInfo), this is a full
oracle: any second solution, however far from the first, is detected.

Usage:
  python3 tools/nurikabe-dupcheck.py <R> <C> "r,c,v r,c,v ..." [--timeout N] [--ptt]

Example:
  python3 tools/nurikabe-dupcheck.py 8 8 "1,3,3 3,3,1 3,5,1 4,7,8 6,1,6 6,4,8 6,7,6 7,5,1 8,1,1"
  python3 tools/nurikabe-dupcheck.py --ptt 8 8 "1,3,3 3,3,1 3,5,1 4,7,8 6,1,6 6,4,8 6,7,6 7,5,1 8,1,1"

Each clue is row,column,value, 1-indexed exactly like the printed grid.

Behaviour:
  - Solves once and prints the first solution board, then forbids that exact
    solution and re-solves. A second solution ⇒ duplicate.
  - stdout carries only the board rendering(s): one board when the solution is
    unique, two boards (blank line between) when it is not. Status lines go to
    stderr, so scripts can parse stdout and rely on the exit code.
  - Exit code: 0 = UNIQUE, 1 = NOT UNIQUE (duplicate), 2 = no solution / usage
    error / timeout.

Board rendering matches the repo tools (nurikabe-solve.mjs): '██' for sea,
fullwidth space (　) for empty island cells, fullwidth digits for clues ≤ 9
(halfwidth ≥ 10), box-drawing border with a 2-char-thick dash. Cell width is
2 halfwidth chars throughout.

Pass --ptt to render for PTT-style terminals, where █ and the box drawing
chars are fullwidth (one cell each): sea becomes a single '█' and the border
dash count halves, so each row stays exactly `<C>` cells.

Encoding (from the reference solver): white[r,c,k] cell-to-island ownership,
black[r,c] sea; one owner per cell; island sizes == clue values; clue cell
owned by its island; distinct islands never orthogonally adjacent; island
connectivity via a "distance to clue" chaining; sea connectivity via the same
distance trick rooted at a SELF-SELECTED sea cell (ExactlyOne root), so no
size-1 clue is required and any board with a sea can be tested; no 2x2
all-black block.
"""

from ortools.sat.python import cp_model
import sys
import time

SP = '\u3000'    # fullwidth space (width 2)

# Rendering constants chosen per --ptt, mirroring nurikabe-solve/debug: default
# uses two halfwidth blocks per cell, PTT uses one fullwidth glyph per cell.
SEA = '\u2588\u2588'   # two halfwidth blocks = one cell
SEA_PTT = '\u2588'     # one fullwidth block
DASH_MUL = 2           # border dash count multiple per cell (default)
DASH_MUL_PTT = 1       # ... one dash per cell in PTT mode


def fmt_num(n):
    return chr(0xFF10 + n) if n <= 9 else str(n)


def render(R, C, black_vals, clue_of_cell, ptt=False):
    dash_mul = DASH_MUL_PTT if ptt else DASH_MUL
    sea = SEA_PTT if ptt else SEA
    lines = ['┌' + '─' * (dash_mul * C) + '┐']
    for r in range(R):
        row = '│'
        for c in range(C):
            if black_vals[r, c]:
                row += sea
            elif (r, c) in clue_of_cell:
                row += fmt_num(clue_of_cell[r, c])
            else:
                row += SP
        lines.append(row + '│')
    lines.append('└' + '─' * (dash_mul * C) + '┘')
    return '\n'.join(lines)


def build_model(R, C, clue_list):
    model = cp_model.CpModel()
    K = len(clue_list)

    white = {(r, c, k): model.NewBoolVar(f'w_{r}_{c}_{k}')
             for r in range(R) for c in range(C) for k in range(K)}
    black = {(r, c): model.NewBoolVar(f'b_{r}_{c}')
             for r in range(R) for c in range(C)}

    def neighbors(r, c):
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C:
                yield nr, nc

    # exactly one owner (sea or a single island) per cell
    for r in range(R):
        for c in range(C):
            model.Add(black[r, c] + sum(white[r, c, k] for k in range(K)) == 1)

    # island sizes
    for k, (_, size) in enumerate(clue_list):
        model.Add(sum(white[r, c, k] for r in range(R) for c in range(C)) == size)

    # clue cell ownership fixed
    for k, (cell, _) in enumerate(clue_list):
        cr, cc = cell
        model.Add(white[cr, cc, k] == 1)
        model.Add(black[cr, cc] == 0)
        for k2 in range(K):
            if k2 != k:
                model.Add(white[cr, cc, k2] == 0)

    # different islands can never touch orthogonally
    for r in range(R):
        for c in range(C):
            for nr, nc in neighbors(r, c):
                if (nr, nc) < (r, c):
                    continue
                for k1 in range(K):
                    for k2 in range(K):
                        if k1 != k2:
                            model.Add(white[r, c, k1] + white[nr, nc, k2] <= 1)

    # island connectivity via "distance to clue" chaining
    for k, (cell, size) in enumerate(clue_list):
        cr, cc = cell
        dist = {(r, c): model.NewIntVar(0, size - 1, f'd_{r}_{c}_{k}')
                for r in range(R) for c in range(C)}
        model.Add(dist[cr, cc] == 0)
        for r in range(R):
            for c in range(C):
                if (r, c) == (cr, cc):
                    continue
                supports = []
                for nr, nc in neighbors(r, c):
                    sup = model.NewBoolVar(f's_{r}_{c}_{k}_{nr}_{nc}')
                    model.Add(white[nr, nc, k] == 1).OnlyEnforceIf(sup)
                    model.Add(dist[nr, nc] == dist[r, c] - 1).OnlyEnforceIf(sup)
                    supports.append(sup)
                model.Add(sum(supports) >= 1).OnlyEnforceIf(white[r, c, k])
                model.Add(dist[r, c] >= 1).OnlyEnforceIf(white[r, c, k])

    # no 2x2 all-black block
    for r in range(R - 1):
        for c in range(C - 1):
            model.Add(black[r, c] + black[r, c + 1] +
                      black[r + 1, c] + black[r + 1, c + 1] <= 3)

    # sea connectivity, root self-selected so any sea-carrying board works
    root_sel = {(r, c): model.NewBoolVar(f'root_{r}_{c}')
                for r in range(R) for c in range(C)}
    model.AddExactlyOne(list(root_sel.values()))
    distb = {(r, c): model.NewIntVar(0, R * C - 1, f'db_{r}_{c}')
             for r in range(R) for c in range(C)}
    for (r, c), sel in root_sel.items():
        model.Add(black[r, c] == 1).OnlyEnforceIf(sel)
        model.Add(distb[r, c] == 0).OnlyEnforceIf(sel)
        supports = []
        for nr, nc in neighbors(r, c):
            sup = model.NewBoolVar(f'sb_{r}_{c}_{nr}_{nc}')
            model.Add(black[nr, nc] == 1).OnlyEnforceIf(sup)
            model.Add(distb[nr, nc] == distb[r, c] - 1).OnlyEnforceIf(sup)
            supports.append(sup)
        # every black cell that is not the root needs a same-sea neighbour one step closer
        model.Add(sum(supports) >= 1).OnlyEnforceIf([black[r, c], sel.Not()])
        model.Add(distb[r, c] >= 1).OnlyEnforceIf([black[r, c], sel.Not()])

    return model, black


def _solver(timeout):
    s = cp_model.CpSolver()
    s.parameters.num_search_workers = 8
    s.parameters.max_time_in_seconds = timeout
    return s


def _read_black(solver, black, R, C):
    return {(r, c): solver.Value(black[r, c])
            for r in range(R) for c in range(C)}


def parse_args(argv):
    timeout = 60
    ptt = False
    positional = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--timeout':
            i += 1
            if i >= len(argv):
                sys.stderr.write('--timeout needs a value\n')
                sys.exit(2)
            timeout = int(argv[i])
        elif a.startswith('--timeout='):
            timeout = int(a.split('=', 1)[1])
        elif a == '--ptt':
            ptt = True
        else:
            positional.append(a)
        i += 1
    return positional, timeout, ptt


def main():
    positional, timeout, ptt = parse_args(sys.argv[1:])

    if len(positional) < 3:
        sys.stderr.write(
            'Usage: python3 tools/nurikabe-dupcheck.py <R> <C> "r,c,v r,c,v ..." [--timeout N] [--ptt]\n')
        sys.exit(2)

    try:
        R, C = int(positional[0]), int(positional[1])
        if R < 1 or C < 1:
            raise ValueError
    except ValueError:
        sys.stderr.write('R and C must be positive integers\n')
        sys.exit(2)

    clue_list = []
    seen_cells = set()
    for token in ' '.join(positional[2:]).split():
        token = token.strip('"')
        try:
            parts = [int(x) for x in token.split(',')]
            if len(parts) != 3:
                raise ValueError
            r, c, v = parts
        except ValueError:
            sys.stderr.write(f'Bad clue token: {token!r} (expected r,c,v)\n')
            sys.exit(2)
        if not (1 <= r <= R and 1 <= c <= C):
            sys.stderr.write(f'Clue {token} is out of bounds\n')
            sys.exit(2)
        if v < 1:
            sys.stderr.write(f'Clue {token} must be positive\n')
            sys.exit(2)
        cell = (r - 1, c - 1)
        if cell in seen_cells:
            sys.stderr.write(f'Duplicate clue cell ({r},{c})\n')
            sys.exit(2)
        seen_cells.add(cell)
        clue_list.append((cell, v))

    K = len(clue_list)
    total_white = sum(v for _, v in clue_list)
    sys.stderr.write(f'grid {R}x{C}, {K} islands, white={total_white}, '
                     f'black={R*C-total_white}\n')

    t0 = time.time()
    model, black = build_model(R, C, clue_list)
    clue_of_cell = dict(clue_list)

    solver1 = _solver(timeout)
    t1 = time.time()
    status1 = solver1.Solve(model)
    sys.stderr.write(f'solve #1: {solver1.StatusName(status1)} in {time.time()-t1:.2f}s\n')
    if status1 not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        sys.stderr.write('No solution exists for these clues (check for a typo).\n')
        sys.exit(2)

    board1 = _read_black(solver1, black, R, C)
    sys.stdout.write(render(R, C, board1, clue_of_cell, ptt) + '\n')

    lits = [black[r, c].Not() if v else black[r, c]
            for (r, c), v in board1.items()]
    model.AddBoolOr(lits)
    solver2 = _solver(timeout)
    t2 = time.time()
    status2 = solver2.Solve(model)
    sys.stderr.write(f'duplicate check: {solver2.StatusName(status2)} in {time.time()-t2:.2f}s\n')

    if status2 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        board2 = _read_black(solver2, black, R, C)
        sys.stdout.write('\n' + render(R, C, board2, clue_of_cell, ptt) + '\n')
        sys.stderr.write('NOT UNIQUE — second solution found.\n')
        sys.exit(1)

    sys.stderr.write('UNIQUE.\n')
    sys.exit(0)


if __name__ == '__main__':
    main()