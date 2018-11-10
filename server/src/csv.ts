import { GeofileParser, GeofileFiletype } from './geofile';

enum CvsParserState {
    ROW = 'ROW',
    FIELD = 'FIELD',
    QFIELD = 'QFIELD',
    COMMA = 'COMMA',
    QQUOTE = 'QQUOTE',
    EOL = 'EOL',
}
const S = CvsParserState;

enum CsvParserToken {
    SPACE = 0x20,
    TAB = 0x09,
    QUOTE = 0x22,
    COMMA = 0x2C,
    SEMICOLON = 0x3B,
    LF = 0x0A,
    CR = 0x0D,
};
const T = CsvParserToken;
interface CsvOptions {
    separator?: number;     // Specifies a single-character string to use as the column separator for each row.
    header?: string[];   // Specifies the header to use. Header define the property key for each value in a CSV row.
    lonfield?: string;     // specify the name of the column containing the longitude coordinate
    latfield?: string;     // specify the name of the column containing the latitude coordinate
    escape?: number;     // A single-character string used to specify the character used to escape strings in a CSV row.
    quote?: number;     // Specifies a single-character string to denote a quoted string.
    skip?: number;     // Specifies the number of lines at the beginning of a data file that the parser should skip over, prior to parsing header
}
const DEFAULT_CVSOPTIONS: CsvOptions = {
    separator: 0x2C,   // ','
    header: null,
    lonfield: 'lon',
    latfield: 'lat',
    escape: 0x22,   // '"' but NOT IMPLEMENTED
    quote: 0X22,   // '"' but NOT IMPLEMENTED
    skip: 0,      // but NOT IMPLEMENTED

}
export class CsvParser implements GeofileParser {
    // implements GeofileParser
    type = GeofileFiletype.CSV;
    collection = [];
    mandatory = true;
    filename: string;
    mdate: Date;

    private options: CsvOptions = DEFAULT_CVSOPTIONS;
    private state = CvsParserState.ROW;
    private field: string = '';
    private row = [];
    private start = 0;
    private offset = 0;


    constructor(filename: string, options?: any) {
        this.filename = filename;
        if (options.separator) this.options.separator = options.separator.charCodeAt(0);
        if (options.header) this.options.header = options.header;
        if (options.lonfield) this.options.lonfield = options.lonfield;
        if (options.latfield) this.options.latfield = options.latfield;
    }

    // send data to the automata 
    onData(buffer: ArrayBuffer) {
        const dv = new DataView(buffer);
        for (let i = 0; i < buffer.byteLength; i++) {
            this.onChar(dv.getUint8(i));
            this.offset += 1;
        }
    }

    onChar(char: number) {
        this[this.state](char);
    }
    pushField() {
        this.row.push(this.field);
        this.field = '';
    }

    pushRow() {
        if (!this.options.header && this.collection.length === 0) {
            if (this.row.length === 1) {
                const line:string = this.row[0];
                if(line.split(/,/).length > 1) {
                    this.options.header = line.split(/,/).map(f => f.replace(/^"|"$/g,''));
                    this.options.separator = CsvParserToken.COMMA;
                }
            } else {
                this.options.header = this.row;
            }
            //console.log('a header => %s', this.row)
        } else {
            const values = this.row.map( v => /^\s*[-+]?\d*(\.\d*([eE]\d+)?)?$/.test(v) ? parseFloat(v) : v);
            const properties = this.options.header.reduce((obj, name, i) => {
                obj[name] = values[i];
                return obj;
            }, {});
            let bbox = null;
            let ilon = this.options.header.indexOf(this.options.lonfield);
            let ilat = this.options.header.indexOf(this.options.latfield);
            if (ilon > 0
                && ilat > 0
                && properties[this.options.header[ilon]] !== null
                && properties[this.options.header[ilat]] !== null
            ) {
                let lon = properties[this.options.header[ilon]];
                let lat = properties[this.options.header[ilat]];
                if (!Number.isNaN(lon) && !Number.isNaN(lat) ) {
                    bbox = [lon, lat, lon, lat];
                }
            }
            const feature = {
                rank: this.collection.length,
                pos: this.start,
                len: this.offset - this.start,
                bbox: bbox,
                properties: properties
            };
            this.collection.push(feature);
            // console.log(`a feature => ${JSON.stringify(feature)}`)
        }
        this.row = [];
    }
    ROW(char: number) {
        switch (char) {
            case T.QUOTE:
                this.state = S.QFIELD;
                break;
            case this.options.separator:
                this.pushField();
                this.state = S.ROW;
                break;
            case T.CR:
            case T.LF:
                this.pushField();
                this.pushRow();
                this.state = S.EOL;
                break;
            default:
                this.field += String.fromCharCode(char);
                this.state = S.FIELD;
                break;
        }
    }

    FIELD(char: number) {
        switch (char) {
            case this.options.separator:
                this.pushField();
                this.state = S.FIELD;
                break;
            case T.CR:
            case T.LF:
                this.pushField();
                this.pushRow();
                this.state = S.EOL;
                break;
            default:
                this.field += String.fromCharCode(char);
                this.state = S.FIELD;
                break;
        }
    }

    QFIELD(char: number) {
        switch (char) {
            case T.QUOTE:
                this.state = S.QQUOTE;
                break;
            default:
                this.field += String.fromCharCode(char);
                this.state = S.FIELD;
                break;
        }
    }
    QQUOTE(char: number) {
        switch (char) {
            case T.QUOTE:
                this.field += '"';
                this.state = S.QFIELD;
                break;
            case T.COMMA:
                this.pushField();
                this.state = S.ROW;
                break;
            case T.CR:
            case T.LF:
                this.pushField();
                this.pushRow();
                this.state = S.EOL;
                break;
            default:
                this.state = S.COMMA;
                break;
        }
    }
    COMMA(char: number) {
        switch (char) {
            case T.COMMA:
                this.state = S.ROW;
                break;
            case T.CR:
            case T.LF:
                this.pushRow();
                this.state = S.EOL;
                break;
            default:
                this.state = S.COMMA;
                break;
        }
    }

    EOL(char: number) {
        switch (char) {
            case T.CR:
            case T.LF:
                this.state = S.EOL;
                break;
            default:
                this.start = this.offset;
                this.state = S.ROW;
                break;
        }
    }
}
