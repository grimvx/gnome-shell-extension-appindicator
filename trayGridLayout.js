// This file is part of the AppIndicator/KStatusNotifierItem GNOME Shell extension
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

export const TRAY_GRID_COLUMNS_DEFAULT = 4;
export const TRAY_GRID_COLUMNS_MIN = 1;
export const TRAY_GRID_COLUMNS_MAX = 12;
const MAX_LABEL_LENGTH = 120;

export function clampColumns(columns) {
    const value = Number.parseInt(columns, 10);
    if (!Number.isFinite(value))
        return TRAY_GRID_COLUMNS_DEFAULT;

    return Math.min(
        TRAY_GRID_COLUMNS_MAX,
        Math.max(TRAY_GRID_COLUMNS_MIN, value));
}

export function gridCell(index, columns) {
    const cols = clampColumns(columns);
    return {
        column: index % cols,
        row: Math.floor(index / cols),
    };
}

/**
 * @param {string} uniqueId Indicator id.
 * @param {object} options Placement options.
 * @param {boolean} options.gridEnabled Whether the popup grid is on.
 * @param {string[]} options.pinnedIds Ids that stay in the top bar.
 * @returns {boolean} True when the icon belongs in the popup.
 */
export function wantsGrid(uniqueId, {gridEnabled, pinnedIds}) {
    if (!gridEnabled)
        return false;

    return !pinnedIds.includes(uniqueId);
}

/**
 * Split icons into popup-grid and top-bar groups, preserving order.
 *
 * @param {Array<{uniqueId: string}>} icons Icons in display order.
 * @param {object} options Options forwarded to wantsGrid().
 * @returns {{inGrid: object[], inPanel: object[]}} The two groups.
 */
export function partitionIcons(icons, options) {
    const inGrid = [];
    const inPanel = [];
    for (const icon of icons) {
        if (wantsGrid(icon.uniqueId, options))
            inGrid.push(icon);
        else
            inPanel.push(icon);
    }
    return {inGrid, inPanel};
}

function indicatorLabel(icon) {
    const id = `${icon.uniqueId ?? ''}`;
    let label = `${icon.label ?? ''}`.replace(/\s+/g, ' ').trim();
    if (!label)
        label = id;
    if (label.length > MAX_LABEL_LENGTH)
        label = `${label.slice(0, MAX_LABEL_LENGTH - 3)}...`;
    return [id, label];
}

/**
 * Build the gsettings a(ss) value for indicators the preferences dialog can pin.
 *
 * @param {Array<{uniqueId: string, label?: string}>} icons Known icons.
 * @returns {string[][]} Sorted [id, label] pairs.
 */
export function knownIndicatorEntries(icons) {
    const entries = icons.map(indicatorLabel).filter(([id]) => id.length > 0);
    entries.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
    return entries;
}

export function sameStringPairs(left, right) {
    if (left.length !== right.length)
        return false;

    for (let i = 0; i < left.length; i++) {
        if (`${left[i][0]}` !== `${right[i][0]}`)
            return false;
        if (`${left[i][1]}` !== `${right[i][1]}`)
            return false;
    }
    return true;
}
