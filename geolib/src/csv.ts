'use strict';
import * as ol from './ol-debug';
import { _ } from './polyfill';
import { Geofile, GeofileFeature, GeofileOptions, GeofileFilterOptions } from './geofile';
import { FSFile, FSFormat } from './sync';
_();

enum STATE {
    ROW = 'ROW',
    FIELD = 'FIELD',
    QFIELD = 'QFIELD',
    COMMA = 'COMMA',
    QQUOTE = 'QQUOTE',
    EOL = 'EOL',
}

enum TOKEN {
    SPACE = ' ',
    TAB = '\t',
    QUOTE = '"',
    COMMA = ',',
    SEMICOLON = ';',
    LF = '\r',
    CR = '\n',
}

class CsvOptions {
    separator?: string; // Specifies a single-character string to use as the column separator for each row.
    header?: string[];  // Specifies the header to use. Header define the property key for each value in a CSV row.
    lonfield?: string;  // specify the name of the column containing the longitude coordinate
    latfield?: string;  // specify the name of the column containing the latitude coordinate
    escape?: number;    // A single-character string used to specify the character used to escape strings in a CSV row.
    quote?: number;     // Specifies a single-character string to denote a quoted string.
    skip?: number;      // Specifies the number of lines at the beginning of a data file to skip over, prior to parsing header
}

export class CsvParser {

    private options: CsvOptions = {
        separator: ',',   // ','
        header: null,
        lonfield: 'lon',
        latfield: 'lat',
        escape: 0x22,   // '"'  NOT IMPLEMENTED
        quote: 0X22,    // '"'  NOT IMPLEMENTED
        skip: 0,        //      NOT IMPLEMENTED
    };
    private state = STATE.ROW;
    private field = '';
    private row: any[]|any = [];
    private propsarr = [];

    private constructor(toparse: string, options?: any) {
        // this.options.applyTo(options.applyTo({}));
        if (options.separator) { this.options.separator = options.separator; }
        if (options.header) { this.options.header = options.header; }
        if (options.lonfield) { this.options.lonfield = options.lonfield; }
        if (options.latfield) { this.options.latfield = options.latfield; }
        const te = new TextEncoder();
        const arrbuf = te.encode(toparse);
        for (let i = 0; i < toparse.length; i++) { this.onChar(toparse.charAt(i)); }
        this.pushField();
        this.buildFeature();
    }

    static parse(toparse: string, options?: CsvOptions): any[]| any {
        const parser = new CsvParser(toparse, options);
        return parser.propsarr;
    }

    onChar(char: string) {
        this[this.state](char);
    }
    pushField() {
        this.row.push(this.field);
        this.field = '';
    }

    buildFeature() {
        let properties = this.row;
        if (this.options.header) {
            properties = this.options.header.reduce((obj, name, i) => {
                obj[name] = this.row[i];
                return obj;
            }, <any>{});
            const ilon = this.options.header.indexOf(this.options.lonfield);
            const ilat = this.options.header.indexOf(this.options.latfield);
            if (ilon > 0 && ilat > 0
                && properties[this.options.header[ilon]] !== null
                && properties[this.options.header[ilat]] !== null
            ) {
                const lon = parseFloat(properties[this.options.header[ilon]]);
                const lat = parseFloat(properties[this.options.header[ilat]]);
                const wkt = `POINT(${lon} ${lat})`;
                if (Array.isArray(properties)) {
                    properties.push(wkt);
                } else {
                    properties['geometry'] = wkt;
                }
            }
        }
        this.propsarr.push(properties);
        this.row = [];
        this.field = '';
    }

    ROW(char: string) {
        switch (char) {
            case TOKEN.QUOTE:
                this.state = STATE.QFIELD;
                break;
            case this.options.separator:
                this.pushField();
                this.state = STATE.ROW;
                break;
            case TOKEN.CR:
            case TOKEN.LF:
                this.pushField();
                this.buildFeature();
                this.state = STATE.EOL;
                break;
            default:
                this.field += char;
                this.state = STATE.FIELD;
                break;
        }
    }

    FIELD(char: string) {
        switch (char) {
            case this.options.separator:
                this.pushField();
                this.state = STATE.FIELD;
                break;
            case TOKEN.CR:
            case TOKEN.LF:
                this.pushField();
                this.buildFeature();
                this.state = STATE.EOL;
                break;
            default:
                this.field += char;
                this.state = STATE.FIELD;
                break;
        }
    }

    QFIELD(char: string) {
        switch (char) {
            case TOKEN.QUOTE:
                this.state = STATE.QQUOTE;
                break;
            default:
                this.field += char;
                this.state = STATE.FIELD;
                break;
        }
    }
    QQUOTE(char: string) {
        switch (char) {
            case TOKEN.QUOTE:
                this.field += '"';
                this.state = STATE.QFIELD;
                break;
            case TOKEN.COMMA:
                this.pushField();
                this.state = STATE.ROW;
                break;
            case TOKEN.CR:
            case TOKEN.LF:
                this.pushField();
                this.buildFeature();
                this.state = STATE.EOL;
                break;
            default:
                this.state = STATE.COMMA;
                break;
        }
    }
    COMMA(char: string) {
        switch (char) {
            case TOKEN.COMMA:
                this.state = STATE.ROW;
                break;
            case TOKEN.CR:
            case TOKEN.LF:
                this.buildFeature();
                this.state = STATE.EOL;
                break;
            default:
                this.state = STATE.COMMA;
                break;
        }
    }

    EOL(char: string) {
        switch (char) {
            case TOKEN.CR:
            case TOKEN.LF:
                this.state = STATE.EOL;
                break;
            case TOKEN.QUOTE:
                this.state = STATE.QFIELD;
                break;
            case this.options.separator:
                this.pushField();
                this.state = STATE.ROW;
                break;
            default:
                this.field += char;
                this.state = STATE.FIELD;
                break;
        }
    }
}


/**
 * File System csv class
 */
export class Csv extends Geofile {

    private static FORMAT = new ol.format.WKT();
    /** data file csv */
    private file: File;
    private header: any[];

    /**
     * promise that resolve to a new created and loaded csv
     * @param filename complete full path and name of the csv file to load
     * @param opts options to configure the created geojson object (see. GeofileOptions)
     * @returns the promise
     */
    static get(filename: string, opts: GeofileOptions = {}): Promise<Geofile> {
        const csv = new Csv(filename, opts);
        return csv.load();
    }
    /** construct a Geojson object (dont use private use static geosjon() method) */
    private constructor(filename: string, opts: GeofileOptions = {}) {
        super(filename, opts);
    }

    /** internal method to get File object for Geojson file for random access */
    loadFeatures(): Promise<any> {
        return FSFile.get(this.filename)
            .then(file => {
                this.file = file;
                const handle = this.getHandle(0);
                return FSFile.slice(this.file, FSFormat.text, 0, handle.pos);
            })
            .then(slice => {
                this.header = CsvParser.parse(slice, { separator: ';' })[0];
            });
    }

    getFeature_(rank: number, options: GeofileFilterOptions = {}): Promise<GeofileFeature> {
        const handle = this.getHandle(rank);
        return FSFile.slice(this.file, FSFormat.text, handle.pos, handle.len)
            .then((slice: string) => {
                const properties =  CsvParser.parse(slice, { separator: ';', header: this.header })[0];
                if (properties.geometry) {
                    const geometry = Csv.FORMAT.readGeometry(properties.geometry);
                    const feature = (new ol.Feature(geometry) as GeofileFeature);
                    delete properties.geometry;
                    feature.setProperties(properties);
                    return feature;
                }
                return null;
            });
    }
    getFeatures_(rank: number, count = 1000, options: GeofileFilterOptions = {}): Promise<GeofileFeature[]> {
        const hmin = this.getHandle(rank);
        const hmax = this.getHandle(rank + count - 1);
        return FSFile.slice(this.file, FSFormat.text, hmin.pos, (hmax.pos + hmax.len - hmin.pos))
            .then((slice: string) => {
                const array = CsvParser.parse(slice, { separator: ';', header: this.header });
                const features = array.map(properties => {
                    if (properties.geometry) {
                        const geometry = Csv.FORMAT.readGeometry(properties.geometry);
                        const feature = (new ol.Feature(geometry) as GeofileFeature);
                        delete properties.geometry;
                        feature.setProperties(properties);
                        return feature;
                    }
                    return null;
                });
                return features;
            });
    }
}

