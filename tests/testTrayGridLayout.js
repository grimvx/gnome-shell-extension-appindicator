#!/usr/bin/gjs -m
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

import System from 'system';

import {
    clampColumns,
    gridCell,
    knownIndicatorEntries,
    partitionIcons,
    sameStringPairs,
    wantsGrid
} from '../trayGridLayout.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

const tests = [
    ['clamps grid columns into the supported range', () => {
        assert(clampColumns(4) === 4, 'default-sized value');
        assert(clampColumns(0) === 1, 'values below 1');
        assert(clampColumns(99) === 12, 'values above 12');
        assert(clampColumns('3') === 3, 'numeric strings');
        assert(clampColumns('nope') === 4, 'values that are not numbers');
    }],
    ['maps an index onto a row and column', () => {
        const cell = gridCell(5, 4);
        assert(cell.column === 1 && cell.row === 1, '4-column grid');
        const single = gridCell(3, 1);
        assert(single.column === 0 && single.row === 3, 'single column');
    }],
    ['keeps every icon in the top bar while the grid is off', () => {
        const icons = [{uniqueId: 'a'}, {uniqueId: 'b'}];
        const placed = partitionIcons(icons, {gridEnabled: false, pinnedIds: []});
        assert(placed.inGrid.length === 0, 'grid stays empty');
        assert(placed.inPanel.map(icon => icon.uniqueId).join(',') === 'a,b',
            'panel keeps insertion order');
    }],
    ['sends unpinned icons to the grid and keeps pinned ones in the bar', () => {
        const icons = [
            {uniqueId: 'app'},
            {uniqueId: 'pinned'},
            {uniqueId: 'other'},
        ];
        assert(wantsGrid('pinned', {gridEnabled: true, pinnedIds: ['pinned']}) === false,
            'pinned id');
        const placed = partitionIcons(icons, {
            gridEnabled: true,
            pinnedIds: ['pinned'],
        });
        assert(placed.inGrid.map(icon => icon.uniqueId).join(',') === 'app,other',
            'grid members');
        assert(placed.inPanel.map(icon => icon.uniqueId).join(',') === 'pinned',
            'panel members');
    }],
    ['builds a stable label list for the preferences pin switches', () => {
        const entries = knownIndicatorEntries([
            {uniqueId: 'b', label: 'Beta'},
            {uniqueId: 'a', label: '  Alpha\nApp  '},
            {uniqueId: 'plain'},
            {uniqueId: '', label: 'ignored'},
        ]);
        assert(entries.length === 3, 'drops an empty id');
        assert(entries[0][0] === 'a' && entries[0][1] === 'Alpha App', 'sorts and trims');
        assert(entries[1][0] === 'b', 'second entry');
        assert(entries[2][1] === 'plain', 'falls back to the id');
        assert(sameStringPairs(entries, [
            ['a', 'Alpha App'],
            ['b', 'Beta'],
            ['plain', 'plain'],
        ]), 'pair comparison');
        assert(sameStringPairs(entries, [['a', 'Alpha App']]) === false, 'different length');
    }],
];

print(`1..${tests.length}`);

let failures = 0;

tests.forEach(([name, testCase], index) => {
    try {
        testCase();
        print(`ok ${index + 1} - ${name}`);
    } catch (error) {
        failures += 1;
        print(`not ok ${index + 1} - ${name}`);
        print(`# ${error.message}`);
    }
});

System.exit(failures ? 1 : 0);
