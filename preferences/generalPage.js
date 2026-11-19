/* exported  GeneralPage*/

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export var GeneralPage = GObject.registerClass(
class AppIndicatorGeneralPage extends Adw.PreferencesPage {
    _init(settings, settingsKey) {
        super._init({
            title: _('General'),
            icon_name: 'general-preferences-symbolic',
            name: 'General Page',
        });

        this._settings = settings;
        this._settingsKey = settingsKey;

        this.group = new Adw.PreferencesGroup();  // no title since only single group

        const legacyTraySwitch = new Adw.SwitchRow({
            title: _('Enable Legacy Tray Icons support'),
            subtitle: _('Add X11 legacy tray icons to the panel area'),
            active: this._settings.get_boolean(this._settingsKey.LEGACY_TRAY_ENABLED),
        });

        legacyTraySwitch.connect('notify::active', widget =>
            this._settings.set_boolean(
                this._settingsKey.LEGACY_TRAY_ENABLED,
                widget.get_active()
            )
        );

        this.group.add(legacyTraySwitch);

        const compactModeSwitch = new Adw.SwitchRow({
            title: _('Compact Mode'),
            subtitle: _('Puts tray indicators closer together'),
            active: this._settings.get_boolean(this._settingsKey.COMPACT_MODE_ENABLED),
        });

        compactModeSwitch.connect('notify::active', widget =>
            this._settings.set_boolean(
                this._settingsKey.COMPACT_MODE_ENABLED,
                widget.get_active()
            )
        );

        this.group.add(compactModeSwitch);

        this._createSpinRow({
            title: _('Opacity'),
            settingsKey: this._settingsKey.ICON_OPACITY,
            from: 0,
            to: 255,
            step: 1,
            round: true,
        });

        this._createSpinRow({
            title: _('Desaturation'),
            settingsKey: this._settingsKey.ICON_SATURATION,
            from: 0.0,
            to: 1.0,
            step: 0.1,
        });

        this._createSpinRow({
            title: _('Brightness'),
            settingsKey: this._settingsKey.ICON_BRIGHTNESS,
            from: -1.0,
            to: 1.0,
            step: 0.1,
        });

        this._createSpinRow({
            title: _('Contrast'),
            settingsKey: this._settingsKey.ICON_CONTRAST,
            from: -1.0,
            to: 1.0,
            step: 0.1,
        });

        this._createSpinRow({
            title: _('Icon Size'),
            settingsKey: this._settingsKey.ICON_SIZE,
            from: 0,
            to: 96,
            step: 2,
            round: true,
        });

        const alignmentList = new Gtk.StringList();
        const comboItems = [
            {pos: 'center', label: _('Center')},
            {pos: 'left', label: _('Left')},
            {pos: 'right', label: _('Right')},
        ];

        comboItems.forEach(item => alignmentList.append(item.label));

        const combo = new Adw.ComboRow({
            title: _('Tray Horizontal Alignment'),
            model: alignmentList,
        });
        const trayPos = this._settings.get_string(this._settingsKey.TRAY_POS);
        combo.set_selected(comboItems.findIndex(item => trayPos === item.pos));

        combo.connect('notify::selected', widget => this._settings.set_string(
            this._settingsKey.TRAY_POS, comboItems[widget.get_selected()].pos));

        this.group.add(combo);
        this.add(this.group);
        this._addTrayGridSettings();
    }

    _addTrayGridSettings() {
        this._updatingPins = false;
        this._pinRows = [];

        const gridGroup = new Adw.PreferencesGroup({
            title: _('Tray grid'),
            description: _('Gather indicator icons into one panel button'),
        });

        const gridSwitch = new Adw.SwitchRow({
            title: _('Show icons in a popup grid'),
            subtitle: _('One top-bar button opens the icons in a grid'),
            active: this._settings.get_boolean(this._settingsKey.TRAY_GRID_ENABLED),
        });
        gridSwitch.connect('notify::active', widget => {
            this._settings.set_boolean(
                this._settingsKey.TRAY_GRID_ENABLED,
                widget.get_active());
        });
        gridGroup.add(gridSwitch);

        const columns = Adw.SpinRow.new_with_range(1, 12, 1);
        columns.title = _('Grid columns');
        columns.subtitle = _('How many icons are placed in one row of the popup');
        columns.set_value(this._settings.get_int(this._settingsKey.TRAY_GRID_COLUMNS));
        columns.connect('notify::value', widget => {
            this._settings.set_int(
                this._settingsKey.TRAY_GRID_COLUMNS,
                Math.round(widget.get_value()));
        });
        gridGroup.add(columns);
        this.add(gridGroup);

        this._pinGroup = new Adw.PreferencesGroup({
            title: _('Pinned icons'),
            description: _('Pinned indicators stay in the top bar while the grid is enabled'),
        });

        this._pinEntry = new Adw.EntryRow({
            title: _('Indicator id'),
        });
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            has_frame: false,
            tooltip_text: _('Pin this indicator id'),
        });
        this._pinEntry.add_suffix(addButton);
        addButton.connect('clicked', () => this._pinEntryId());
        this._pinEntry.connect('apply', () => this._pinEntryId());
        this._pinGroup.add(this._pinEntry);
        this.add(this._pinGroup);

        const knownKey = `changed::${this._settingsKey.TRAY_GRID_KNOWN}`;
        const pinnedKey = `changed::${this._settingsKey.TRAY_GRID_PINNED}`;
        this._settings.connect(knownKey, () => this._rebuildPinRows());
        this._settings.connect(pinnedKey, () => this._rebuildPinRows());
        this._rebuildPinRows();
    }

    _knownIndicators() {
        const known = new Map();
        const unpacked = this._settings.get_value(this._settingsKey.TRAY_GRID_KNOWN).deep_unpack();
        for (const entry of unpacked) {
            const id = `${entry[0] ?? ''}`.trim();
            if (!id)
                continue;

            const label = `${entry[1] ?? ''}`.trim() || id;
            known.set(id, label);
        }
        return known;
    }

    _setPinned(id, pinned) {
        const key = this._settingsKey.TRAY_GRID_PINNED;
        const current = new Set(this._settings.get_strv(key));
        if (pinned)
            current.add(id);
        else
            current.delete(id);

        this._updatingPins = true;
        try {
            this._settings.set_strv(key, [...current].sort());
        } finally {
            this._updatingPins = false;
        }
    }

    _pinEntryId() {
        const id = this._pinEntry.get_text().trim();
        if (!id)
            return;

        this._setPinned(id, true);
        this._pinEntry.set_text('');
        this._rebuildPinRows();
    }

    _rebuildPinRows() {
        if (this._updatingPins)
            return;

        for (const row of this._pinRows)
            this._pinGroup.remove(row);
        this._pinRows = [];

        const known = this._knownIndicators();
        const pinned = new Set(this._settings.get_strv(this._settingsKey.TRAY_GRID_PINNED));
        const ids = [...new Set([...known.keys(), ...pinned])];
        ids.sort((a, b) => {
            const labelA = known.get(a) || a;
            const labelB = known.get(b) || b;
            return labelA.localeCompare(labelB) || a.localeCompare(b);
        });

        if (ids.length === 0) {
            const empty = new Adw.ActionRow({
                title: _('No indicators seen yet'),
                subtitle: _('They are listed here while the extension is enabled'),
            });
            this._pinGroup.add(empty);
            this._pinRows.push(empty);
            return;
        }

        for (const id of ids) {
            const label = known.get(id) || id;
            const row = new Adw.SwitchRow({
                title: label,
                active: pinned.has(id),
            });
            if (id !== label)
                row.subtitle = id;

            row.connect('notify::active', widget => {
                this._setPinned(id, widget.get_active());
            });
            this._pinGroup.add(row);
            this._pinRows.push(row);
        }
    }

    _createSpinRow(args) {
        let title =  args.title || 'Default Title';
        let subtitle = args.subtitle || null;
        let settingsKey = args.settingsKey || '';
        let from = args.from || 0;
        let to = args.to || 100;
        let step = args.step || 1;
        let round = args.round || false;

        let spin = Adw.SpinRow.new_with_range(from, to, step);
        spin.title = title;
        if (subtitle !== null)
            spin.subtitle = subtitle;

        if (round)
            spin.set_value(this._settings.get_int(settingsKey));
        else
            spin.set_value(this._settings.get_int(settingsKey));


        spin.connect('input', widget => {
            if (round)
                this._settings.set_int(settingsKey, parseInt(widget.get_value(), 10));
            else
                this._settings.set_double(settingsKey, widget.get_value());

            return false;
        });
        spin.connect('output', widget => {
            if (round)
                this._settings.set_int(settingsKey, parseInt(widget.get_value(), 10));
            else
                this._settings.set_double(settingsKey, widget.get_value());

            return false;
        });

        this.group.add(spin);
    }
});


