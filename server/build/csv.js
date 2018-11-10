"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var geofile_1 = require("./geofile");
var CvsParserState;
(function (CvsParserState) {
    CvsParserState["ROW"] = "ROW";
    CvsParserState["FIELD"] = "FIELD";
    CvsParserState["QFIELD"] = "QFIELD";
    CvsParserState["COMMA"] = "COMMA";
    CvsParserState["QQUOTE"] = "QQUOTE";
    CvsParserState["EOL"] = "EOL";
})(CvsParserState || (CvsParserState = {}));
var S = CvsParserState;
var CsvParserToken;
(function (CsvParserToken) {
    CsvParserToken[CsvParserToken["SPACE"] = 32] = "SPACE";
    CsvParserToken[CsvParserToken["TAB"] = 9] = "TAB";
    CsvParserToken[CsvParserToken["QUOTE"] = 34] = "QUOTE";
    CsvParserToken[CsvParserToken["COMMA"] = 44] = "COMMA";
    CsvParserToken[CsvParserToken["SEMICOLON"] = 59] = "SEMICOLON";
    CsvParserToken[CsvParserToken["LF"] = 10] = "LF";
    CsvParserToken[CsvParserToken["CR"] = 13] = "CR";
})(CsvParserToken || (CsvParserToken = {}));
;
var T = CsvParserToken;
var DEFAULT_CVSOPTIONS = {
    separator: 0x2C,
    header: null,
    lonfield: 'lon',
    latfield: 'lat',
    escape: 0x22,
    quote: 0X22,
    skip: 0,
};
var CsvParser = /** @class */ (function () {
    function CsvParser(filename, options) {
        // implements GeofileParser
        this.type = geofile_1.GeofileFiletype.CSV;
        this.collection = [];
        this.mandatory = true;
        this.options = DEFAULT_CVSOPTIONS;
        this.state = CvsParserState.ROW;
        this.field = '';
        this.row = [];
        this.start = 0;
        this.offset = 0;
        this.filename = filename;
        if (options.separator)
            this.options.separator = options.separator.charCodeAt(0);
        if (options.header)
            this.options.header = options.header;
        if (options.lonfield)
            this.options.lonfield = options.lonfield;
        if (options.latfield)
            this.options.latfield = options.latfield;
    }
    // send data to the automata 
    CsvParser.prototype.onData = function (buffer) {
        var dv = new DataView(buffer);
        for (var i = 0; i < buffer.byteLength; i++) {
            this.onChar(dv.getUint8(i));
            this.offset += 1;
        }
    };
    CsvParser.prototype.onChar = function (char) {
        this[this.state](char);
    };
    CsvParser.prototype.pushField = function () {
        this.row.push(this.field);
        this.field = '';
    };
    CsvParser.prototype.pushRow = function () {
        if (!this.options.header && this.collection.length === 0) {
            if (this.row.length === 1) {
                var line = this.row[0];
                if (line.split(/,/).length > 1) {
                    this.options.header = line.split(/,/).map(function (f) { return f.replace(/^"|"$/g, ''); });
                    this.options.separator = CsvParserToken.COMMA;
                }
            }
            else {
                this.options.header = this.row;
            }
            //console.log('a header => %s', this.row)
        }
        else {
            var values_1 = this.row.map(function (v) { return /^\s*[-+]?\d*(\.\d*([eE]\d+)?)?$/.test(v) ? parseFloat(v) : v; });
            var properties = this.options.header.reduce(function (obj, name, i) {
                obj[name] = values_1[i];
                return obj;
            }, {});
            var bbox = null;
            var ilon = this.options.header.indexOf(this.options.lonfield);
            var ilat = this.options.header.indexOf(this.options.latfield);
            if (ilon > 0
                && ilat > 0
                && properties[this.options.header[ilon]] !== null
                && properties[this.options.header[ilat]] !== null) {
                var lon = properties[this.options.header[ilon]];
                var lat = properties[this.options.header[ilat]];
                if (!Number.isNaN(lon) && !Number.isNaN(lat)) {
                    bbox = [lon, lat, lon, lat];
                }
            }
            var feature = {
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
    };
    CsvParser.prototype.ROW = function (char) {
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
    };
    CsvParser.prototype.FIELD = function (char) {
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
    };
    CsvParser.prototype.QFIELD = function (char) {
        switch (char) {
            case T.QUOTE:
                this.state = S.QQUOTE;
                break;
            default:
                this.field += String.fromCharCode(char);
                this.state = S.FIELD;
                break;
        }
    };
    CsvParser.prototype.QQUOTE = function (char) {
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
    };
    CsvParser.prototype.COMMA = function (char) {
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
    };
    CsvParser.prototype.EOL = function (char) {
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
    };
    return CsvParser;
}());
exports.CsvParser = CsvParser;
//# sourceMappingURL=csv.js.map