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

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {
    gettext as _,
    ngettext
} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as SettingsManager from './settingsManager.js';
import * as Util from './util.js';
import {
    clampColumns,
    gridCell,
    knownIndicatorEntries,
    sameStringPairs,
    wantsGrid
} from './trayGridLayout.js';

const GRID_BUTTON_ROLE = 'appindicator-tray-grid';
// One value for both axes. Extra horizontal padding used to live only in
// the panel button, so rows looked tighter than columns.
const GRID_CELL_SPACING = 8;

const trackedIcons = new Set();
const gridAlign = new WeakMap();
const gridExpand = new WeakMap();
let placement = null;

function pinToGridCell(icon) {
    const {container} = icon;
    if (container && !gridAlign.has(container)) {
        gridAlign.set(container, {
            x: container.x_align,
            y: container.y_align,
        });
        container.x_align = Clutter.ActorAlign.CENTER;
        container.y_align = Clutter.ActorAlign.CENTER;
    }

    // St.Icon centers its texture in the actor. Expanding it makes that
    // texture sit in the middle of the square hit target.
    const actor = icon._icon;
    if (actor && !gridExpand.has(actor)) {
        gridExpand.set(actor, actor.x_expand);
        actor.x_expand = true;
    }
}

function releaseGridCell(icon) {
    const {container} = icon;
    const align = container && gridAlign.get(container);
    if (align) {
        container.x_align = align.x;
        container.y_align = align.y;
        gridAlign.delete(container);
    }

    const actor = icon._icon;
    if (actor && gridExpand.has(actor)) {
        actor.x_expand = gridExpand.get(actor);
        gridExpand.delete(actor);
    }
}

function panelBox(position) {
    if (position === 'left')
        return Main.panel._leftBox;
    if (position === 'center')
        return Main.panel._centerBox;
    return Main.panel._rightBox;
}

function isRealMenu(icon) {
    const {menu} = icon;
    if (!menu || menu.actor === icon)
        return false;
    return !(menu instanceof PopupMenu.PopupDummyMenu);
}

/**
 * Top-bar button whose popup lays status icons out in a grid.
 * Icon menus use their own menu manager so opening one does not
 * dismiss the grid (both would otherwise share the panel manager).
 */
const TrayGridButton = GObject.registerClass(
class AppIndicatorTrayGridButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, _('Tray icons'));

        this._chevron = new St.Icon({
            icon_name: 'pan-down-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._chevron);
        this.add_style_class_name('appindicator-tray-grid-button');
        // .popup-menu is min-width: 15em. Without this the grid floats
        // in the middle of a menu sized for text rows.
        this.menu.actor.add_style_class_name('appindicator-tray-grid-menu');

        this._gridLayout = new Clutter.GridLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            column_homogeneous: true,
            row_homogeneous: true,
            column_spacing: GRID_CELL_SPACING,
            row_spacing: GRID_CELL_SPACING,
        });
        this._grid = new St.Widget({
            style_class: 'appindicator-tray-grid',
            layout_manager: this._gridLayout,
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: false,
            y_expand: false,
        });

        this._tooltipLabel = new St.Label({
            style_class: 'dash-label appindicator-tray-tooltip',
            x_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._tooltipLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._tooltipIcon = null;
        this._tooltipFitId = 0;
        this._grid.connect('notify::width', () => this._queueTooltipFit());
        this.connect('destroy', () => {
            if (this._tooltipFitId) {
                GLib.source_remove(this._tooltipFitId);
                this._tooltipFitId = 0;
            }
        });

        this._emptyLabel = new St.Label({
            text: _('No tray icons'),
            style_class: 'appindicator-tray-grid-empty',
            x_align: Clutter.ActorAlign.CENTER,
        });

        this._section = new PopupMenu.PopupMenuSection();
        this._section.actor.add_style_class_name('appindicator-tray-grid-section');
        this._section.box.add_child(this._grid);
        this._section.box.add_child(this._tooltipLabel);
        this._section.box.add_child(this._emptyLabel);
        this.menu.addMenuItem(this._section);

        // Separate from Main.panel.menuManager: that manager closes the
        // previously open menu, which would hide the grid and unmap the icon
        // the child menu is anchored to.
        this._iconMenuManager = new PopupMenu.PopupMenuManager(this);
        this._claimed = new Set();
        this._closingChildren = false;

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            this._chevron.icon_name = isOpen ? 'pan-up-symbolic' : 'pan-down-symbolic';
            if (!isOpen) {
                this._closeChildMenus();
                this.setTooltip(null);
            }
        });
    }

    relayout(icons, columns) {
        const children = [...this._grid.get_children()];
        for (const child of children)
            this._grid.remove_child(child);

        let shown = 0;
        for (const icon of icons) {
            const {container} = icon;
            if (!container)
                continue;

            if (!icon.visible) {
                releaseGridCell(icon);
                container.get_parent()?.remove_child(container);
                continue;
            }

            const {column, row} = gridCell(shown, columns);
            container.get_parent()?.remove_child(container);
            pinToGridCell(icon);
            this._grid.add_child(container);
            this._gridLayout.attach(container, column, row, 1, 1);
            shown += 1;
        }

        const empty = shown === 0;
        this._grid.visible = !empty;
        this._emptyLabel.visible = empty;
        if (empty || (this._tooltipIcon && !icons.includes(this._tooltipIcon)))
            this.setTooltip(null);
        else if (this._tooltipIcon)
            this.setTooltip(this._tooltipIcon);

        return shown;
    }

    claimMenu(icon) {
        if (this._claimed.has(icon) || !isRealMenu(icon))
            return;

        const {menu} = icon;
        try {
            if (menu.isOpen)
                Util.closeMenu(menu, false);
            if (menu._openChangedConnected && Main.panel.menuManager) {
                Main.panel.menuManager.removeMenu(menu);
                menu._openChangedConnected = false;
            }
            this._iconMenuManager.addMenu(menu);
            this._claimed.add(icon);
        } catch (e) {
            Util.Logger.warn(`Could not attach an indicator menu to the tray grid: ${e}`);
        }
    }

    releaseMenu(icon) {
        if (!this._claimed.delete(icon))
            return;

        const {menu} = icon;
        if (!menu)
            return;

        try {
            if (menu.isOpen)
                Util.closeMenu(menu, false);
            this._iconMenuManager.removeMenu(menu);
        } catch (e) {
            Util.Logger.warn(`Could not detach an indicator menu from the tray grid: ${e}`);
        }

        if (!isRealMenu(icon) || !Main.panel.menuManager)
            return;

        try {
            if (!menu._openChangedConnected) {
                Main.panel.menuManager.addMenu(menu);
                menu._openChangedConnected = true;
            }
        } catch (e) {
            Util.Logger.warn(`Could not return an indicator menu to the panel: ${e}`);
        }
    }

    drop(icon) {
        this._claimed.delete(icon);
        this.clearTooltipFor(icon);
    }

    clearTooltipFor(icon) {
        if (this._tooltipIcon === icon)
            this.setTooltip(null);
    }

    unparentFromGrid(icon) {
        releaseGridCell(icon);
        const parent = icon.container?.get_parent?.();
        if (parent === this._grid)
            parent.remove_child(icon.container);
    }

    setTooltip(icon) {
        this._tooltipIcon = icon;
        const text = icon?.accessible_name?.trim?.() || '';
        if (!icon || !text || icon.menu?.isOpen) {
            this._tooltipLabel.text = '';
            this._tooltipLabel.hide();
            if (!icon)
                this._tooltipIcon = null;
            return;
        }

        this._tooltipLabel.text = text;
        this._fitTooltip();
        this._tooltipLabel.show();
    }

    _queueTooltipFit() {
        if (this._tooltipFitId)
            return;

        // Width changes while the menu is allocating. Fitting immediately
        // would queue another relayout from inside that allocation.
        this._tooltipFitId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._tooltipFitId = 0;
            this._fitTooltip();
            return GLib.SOURCE_REMOVE;
        });
    }

    // A fixed width skips the label's text measurement, which is what
    // used to force the menu to 220px. Padding stays inside that width.
    _fitTooltip() {
        const gridWidth = Math.round(this._grid.width);
        if (gridWidth > 1)
            this._tooltipLabel.width = gridWidth;
    }

    _closeChildMenus() {
        if (this._closingChildren)
            return;

        this._closingChildren = true;
        try {
            for (const icon of this._claimed) {
                if (icon.menu?.isOpen)
                    Util.closeMenu(icon.menu, false);
            }
        } finally {
            this._closingChildren = false;
        }
    }
});

class IconPlacement {
    constructor() {
        this._destroyed = false;
        this._syncing = false;
        this._idleId = 0;
        this._schemaWarnings = new Set();
        this._inGrid = new Set();
        this._settings = SettingsManager.getDefaultGSettings();
        this._settingsIds = [];
        this._button = null;

        const existing = Main.panel.statusArea[GRID_BUTTON_ROLE];
        if (existing)
            existing.destroy();

        this._button = new TrayGridButton();
        try {
            Main.panel.addToStatusArea(
                GRID_BUTTON_ROLE,
                this._button,
                0,
                this._readString('tray-pos', 'right'));

            const keys = [
                'tray-grid-enabled',
                'tray-grid-columns',
                'tray-grid-pinned',
                'tray-pos',
            ];
            for (const key of keys) {
                this._settingsIds.push(this._settings.connect(`changed::${key}`, () => {
                    this._syncAll();
                }));
            }
            this._syncAll();
        } catch (e) {
            this.destroy();
            throw e;
        }
    }

    place() {
        this._syncAll();
    }

    forget(icon) {
        if (this._destroyed)
            return;

        this._inGrid.delete(icon);
        this._button?.drop(icon);
        this._scheduleSync();
    }

    onHover(icon) {
        if (this._destroyed || !this._button)
            return;

        if (!icon.hover || !icon.visible || !this._inGrid.has(icon)) {
            this._button.clearTooltipFor(icon);
            return;
        }

        this._button.setTooltip(icon);
    }

    scheduleFromIcon() {
        this._scheduleSync();
    }

    destroy() {
        this._destroyed = true;
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }

        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        const button = this._button;
        this._button = null;
        if (button) {
            for (const icon of [...this._inGrid]) {
                button.drop(icon);
                button.unparentFromGrid(icon);
            }
            button.destroy();
        }
        this._inGrid.clear();
    }

    _scheduleSync() {
        if (this._destroyed || this._idleId)
            return;

        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            if (!this._destroyed)
                this._syncAll();
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncAll() {
        if (this._destroyed)
            return;
        if (this._syncing) {
            this._scheduleSync();
            return;
        }

        this._syncing = true;
        try {
            const options = this._gridOptions();
            if (!options.gridEnabled && this._button.menu?.isOpen)
                Util.closeMenu(this._button.menu, false);
            // Hide the bin the panel packs, otherwise a hidden button still
            // leaves a gap in the top bar.
            this._button.container.visible = options.gridEnabled;
            this._button.visible = options.gridEnabled;
            this._placeButton();
            this._rebuildMembership(options);
            const shown = this._button.relayout([...this._inGrid], this._columns());
            this._updateAccessibleName(shown);
            this._writeKnown();
        } finally {
            this._syncing = false;
        }
    }

    _rebuildMembership(options) {
        this._inGrid.clear();
        for (const icon of trackedIcons) {
            this._ensureOnPanel(icon);
            if (wantsGrid(icon.uniqueId, options)) {
                this._inGrid.add(icon);
                this._button.claimMenu(icon);
            } else {
                this._button.releaseMenu(icon);
                this._reparentToPanel(icon);
            }
        }
    }

    _ensureOnPanel(icon) {
        const role = `appindicator-${icon.uniqueId}`;
        if (Main.panel.statusArea[role] === icon)
            return;

        const existing = Main.panel.statusArea[role];
        if (existing)
            existing.destroy();

        Main.panel.addToStatusArea(
            role,
            icon,
            1,
            this._readString('tray-pos', 'right'));
    }

    _reparentToPanel(icon) {
        releaseGridCell(icon);
        const box = panelBox(this._readString('tray-pos', 'right'));
        const {container} = icon;
        if (!container || container.get_parent() === box)
            return;

        container.get_parent()?.remove_child(container);
        box.insert_child_at_index(container, 1);
    }

    _placeButton() {
        const box = panelBox(this._readString('tray-pos', 'right'));
        const {container} = this._button;
        if (!container || container.get_parent() === box)
            return;

        container.get_parent()?.remove_child(container);
        box.insert_child_at_index(container, 0);
    }

    _updateAccessibleName(shown) {
        if (!shown) {
            this._button.accessible_name = _('Tray icons');
            return;
        }

        const label = ngettext('%d tray icon', '%d tray icons', shown);
        this._button.accessible_name = label.format(shown);
    }

    _writeKnown() {
        let current = [];
        try {
            current = this._settings.get_value('tray-grid-known').deep_unpack();
        } catch (e) {
            this._warnSchema('tray-grid-known', e);
            return;
        }

        const entries = knownIndicatorEntries([...trackedIcons].map(icon => ({
            uniqueId: icon.uniqueId,
            label: icon.accessible_name || icon.uniqueId,
        })));
        if (sameStringPairs(current, entries))
            return;

        try {
            this._settings.set_value('tray-grid-known', new GLib.Variant('a(ss)', entries));
        } catch (e) {
            this._warnSchema('tray-grid-known', e);
        }
    }

    _columns() {
        try {
            return clampColumns(this._settings.get_int('tray-grid-columns'));
        } catch (e) {
            this._warnSchema('tray-grid-columns', e);
            return clampColumns(undefined);
        }
    }

    _gridOptions() {
        let gridEnabled = false;
        let pinnedIds = [];
        try {
            gridEnabled = this._settings.get_boolean('tray-grid-enabled');
        } catch (e) {
            this._warnSchema('tray-grid-enabled', e);
        }
        try {
            pinnedIds = [...this._settings.get_strv('tray-grid-pinned')];
        } catch (e) {
            this._warnSchema('tray-grid-pinned', e);
        }
        return {gridEnabled, pinnedIds};
    }

    _readString(key, fallback) {
        try {
            return this._settings.get_string(key);
        } catch (e) {
            this._warnSchema(key, e);
            return fallback;
        }
    }

    _warnSchema(key, error) {
        if (this._schemaWarnings.has(key))
            return;

        this._schemaWarnings.add(key);
        Util.Logger.warn(
            `GSetting '${key}' is missing (${error.message}). ` +
            'Compile the extension schemas to use the tray grid.');
    }
}

function watchIcon(icon) {
    icon.connect('destroy', () => {
        trackedIcons.delete(icon);
        placement?.forget(icon);
    });
    icon.connect('notify::visible', () => placement?.scheduleFromIcon());
    icon.connect('notify::hover', () => placement?.onHover(icon));
    icon.connect('notify::accessible-name', () => placement?.scheduleFromIcon());
    if (isRealMenu(icon)) {
        icon.menu.connect('open-state-changed', () => {
            placement?.onHover(icon);
        });
    }
}

export function enable() {
    if (placement)
        return;

    placement = new IconPlacement();
}

export function disable() {
    const current = placement;
    placement = null;
    current?.destroy();

    for (const icon of [...trackedIcons]) {
        trackedIcons.delete(icon);
        try {
            icon.destroy();
        } catch (_e) {
            // The actor was already disposed with its parent.
        }
    }
}

export function addStatusIcon(icon) {
    if (!trackedIcons.has(icon)) {
        trackedIcons.add(icon);
        watchIcon(icon);
    }

    placement?.place();
}

export function getStatusIcons() {
    return [...trackedIcons];
}
