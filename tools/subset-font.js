#!/usr/bin/env node
/**
 * subset-font — Create a woff2 subset of Unifont for a given Unicode range.
 *
 * Usage:
 *   node tools/subset-font.js U+2B00-2BFF fonts/unifont-misc-arrows.woff2
 *   node tools/subset-font.js "U+2600-26FF,U+2700-27BF" fonts/unifont-misc.woff2
 *
 * Requires:
 *   - fonts-unifont package (system OTF at /usr/share/fonts/opentype/unifont/unifont.otf)
 *   - fonttools (pyftsubset on PATH)
 *
 * Output: woff2 file at the specified path (relative to project root).
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const UNIFONT_SRC = '/usr/share/fonts/opentype/unifont/unifont.otf';

function main() {
    const [,, unicodes, output] = process.argv;

    if (!unicodes || !output) {
        process.stderr.write('Usage: node tools/subset-font.js <unicodes> <output.woff2>\n');
        process.stderr.write('  e.g. node tools/subset-font.js U+2B00-2BFF fonts/unifont-misc-arrows.woff2\n');
        process.exit(1);
    }

    if (!fs.existsSync(UNIFONT_SRC)) {
        process.stderr.write('Unifont OTF not found at ' + UNIFONT_SRC + '\n');
        process.stderr.write('Install: sudo apt install fonts-unifont\n');
        process.exit(1);
    }

    // Resolve output relative to project root (two levels up from tools/)
    const projectRoot = path.resolve(__dirname, '..');
    const outPath = path.resolve(projectRoot, output);

    // Verify pyftsubset is available
    try {
        execSync('which pyftsubset', { stdio: 'ignore' });
    } catch {
        process.stderr.write('pyftsubset not found on PATH. Install: pip install fonttools\n');
        process.exit(1);
    }

    process.stderr.write(`Subsetting Unifont: ${unicodes}\n`);
    process.stderr.write(`Output: ${outPath}\n`);

    execSync(
        `pyftsubset "${UNIFONT_SRC}" ` +
        `--unicodes="${unicodes}" ` +
        `--flavor=woff2 ` +
        `--output-file="${outPath}" ` +
        `--drop-tables+=FFTM`,
        { stdio: 'inherit' }
    );

    // Verify
    const result = execSync(
        `python3 -c "from fontTools.ttLib import TTFont; f=TTFont('${outPath}'); cmap=f.getBestCmap(); print(len([cp for cp in range(0x2B00,0x2C00) if cp in cmap]))"`,
        { encoding: 'utf8' }
    );
    const stats = fs.statSync(outPath);
    process.stderr.write(`\nCreated: ${outPath}\n`);
    process.stderr.write(`Size: ${stats.size} bytes\n`);
}

main();
