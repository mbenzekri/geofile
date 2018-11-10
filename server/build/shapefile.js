'use strict';
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var geofile_1 = require("./geofile");
var polyfill_1 = require("./polyfill");
var util_1 = require("util");
polyfill_1._();
var ShpGeomType;
(function (ShpGeomType) {
    ShpGeomType[ShpGeomType["NullShape"] = 0] = "NullShape";
    ShpGeomType[ShpGeomType["Point"] = 1] = "Point";
    ShpGeomType[ShpGeomType["PolyLine"] = 3] = "PolyLine";
    ShpGeomType[ShpGeomType["Polygon"] = 5] = "Polygon";
    ShpGeomType[ShpGeomType["MultiPoint"] = 8] = "MultiPoint";
    ShpGeomType[ShpGeomType["PointZ"] = 11] = "PointZ";
    ShpGeomType[ShpGeomType["PolyLineZ"] = 13] = "PolyLineZ";
    ShpGeomType[ShpGeomType["PolygonZ"] = 15] = "PolygonZ";
    ShpGeomType[ShpGeomType["MultiPointZ"] = 18] = "MultiPointZ";
    ShpGeomType[ShpGeomType["PointM"] = 21] = "PointM";
    ShpGeomType[ShpGeomType["PolyLineM"] = 23] = "PolyLineM";
    ShpGeomType[ShpGeomType["PolygonM"] = 25] = "PolygonM";
    ShpGeomType[ShpGeomType["MultiPointM"] = 28] = "MultiPointM";
    ShpGeomType[ShpGeomType["MultiPatch"] = 31] = "MultiPatch";
})(ShpGeomType || (ShpGeomType = {}));
var ShapefileDbfParser = /** @class */ (function (_super) {
    __extends(ShapefileDbfParser, _super);
    function ShapefileDbfParser(shpname) {
        var _this = _super.call(this, shpname.replace(/\..*$/, '.dbf'), geofile_1.GeofileFiletype.DBF, false) || this;
        _this.fields = new Map();
        _this.rank = 0;
        _this.parseDbfHeader();
        return _this;
    }
    ShapefileDbfParser.prototype.parseDbfHeader = function () {
        var _this = this;
        var myself = this;
        // Byte     Contents        Meaning
        // -------  ----------      -------------------------------------------------
        // 0        1byte           Valid dBASE IV file; bits 0-2 indicate version
        //                          number, bit 3 the presence of a dBASE IV memo
        //                          file, bits 4-6 the presence of an SQL table, bit
        //                          7 the presence of any memo file (either dBASE III
        //                          PLUS or dBASE IV).
        // 1-3      3 bytes         Date of last update; formattted as YYMMDD.
        // 4-7      32-bit          number Number of records in the file.
        // 8-9      16-bit number   Number of bytes in the header.
        // 10-11    16-bit number   Number of bytes in the record.
        // 12-13    2 bytes         Reserved; fill with 0.
        // 14       1 byte          Flag indicating incomplete transaction.
        // 15       1 byte          Encryption flag.
        // 16-27    12 bytes        Reserved for dBASE IV in a multi-user environment.
        // 28       1 bytes         Production MDX file flag; 01H if there is an MDX,
        //                          00H if not.
        // 29       1 byte          Language driver ID.
        // 30-31    2 bytes         Reserved; fill with 0.
        // 32-n*    32 bytes        each Field descriptor array (see beelow).
        // n + 1    1 byte          0DH as the field terminator.
        this.wait(32, function (dv) {
            _this.dbfheader = {
                code: dv.getUint8(0),
                lastUpdate: new Date(1900 + dv.getUint8(1), dv.getUint8(2) - 1, dv.getUint8(3)),
                count: dv.getUint32(4, true),
                headerSize: dv.getUint16(8, true),
                recordSize: dv.getUint16(10, true),
                encrypted: dv.getUint8(15)
            };
            _this.parseDbfFields();
        });
    };
    ShapefileDbfParser.prototype.parseDbfFields = function () {
        var _this = this;
        // Byte     Contents        Meaning
        // -------  ------------    --------------------------------------------------
        // 0-10     11 bytes        Field name in ASCII (zero-filled).
        // 11       1 byte          Field type in ASCII (C, D, F, L, M, or N).
        // 12-15    4 bytes         Reserved.
        // 16       1 byte          Field length in binary.
        // 17       1 byte          Field decimal count in binary.
        // 18-19    2 bytes         Reserved.
        // 20       1 byte          Work area ID.
        // 21-30    10 bytes        Reserved.
        // 31       1 byte          Production MDX field flag; 01H if field has an
        //                          index tag in the production MDX file, 00H if not.
        var fldsize = this.dbfheader.headerSize - 33; // la taille du header contient le dbfheader + 0x0D final
        this.wait(fldsize, function (dv) {
            var offset = 0;
            var _loop_1 = function (pos) {
                var field = {
                    name: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (i) { return String.fromCharCode(dv.getUint8(pos + i)); }).join('').trimzero(),
                    type: String.fromCharCode(dv.getUint8(pos + 11)),
                    offset: offset,
                    length: dv.getUint8(pos + 16),
                    decimal: dv.getUint8(pos + 17)
                };
                _this.fields.set(field.name, field);
                offset += field.length;
            };
            for (var pos = 0; pos < fldsize; pos += 32) {
                _loop_1(pos);
            }
            _this.skip(2, function () { return _this.parseDbfData(); }); // il y a un caractere 0x0D à la fin du header
        });
    };
    ShapefileDbfParser.prototype.parseDbfData = function () {
        var _this = this;
        this.wait(this.dbfheader.recordSize, function (dv) {
            var td = new util_1.TextDecoder('utf8');
            var attributes = new Object();
            _this.fields.forEach(function (field, name) {
                // type = C (Character) All OEM code page characters.
                // type = D (Date) Numbers and a character to separate month, day, and year (stored internally as 8 digits in YYYYMMDD format).
                // type = F (Floating - . 0 1 2 3 4 5 6 7 8 9 point binary numeric)
                // type = N (Binary - . 0 1 2 3 4 5 6 7 8 9 coded decimal numeric)
                // type = L (Logical) ? Y y N n T t F f (? when not initialized).
                // type = M (Memo) All OEM code page characters (stored internally as 10 digits representing a .DBT block number).
                var val = null;
                switch (field.type) {
                    case 'C':
                    case 'M':
                        val = td.decode(dv.buffer.slice(dv.byteOffset + field.offset, dv.byteOffset + field.offset + field.length)).trimzero().trim();
                        break;
                    case 'D':
                        var yyyy = td.decode(dv.buffer.slice(dv.byteOffset + field.offset, dv.byteOffset + field.offset + 4));
                        var mm = td.decode(dv.buffer.slice(dv.byteOffset + field.offset + 4, dv.byteOffset + field.offset + 6));
                        var dd = td.decode(dv.buffer.slice(dv.byteOffset + field.offset + 6, dv.byteOffset + field.offset + 8));
                        val = new Date(parseInt(yyyy), parseInt(mm), parseInt(dd));
                        break;
                    case 'F':
                    case 'N':
                        val = td.decode(dv.buffer.slice(dv.byteOffset + field.offset, dv.byteOffset + field.offset + field.length)).trimzero().trim();
                        val = parseFloat(val);
                        break;
                    case 'I':
                        val = td.decode(dv.buffer.slice(dv.byteOffset + field.offset, dv.byteOffset + field.offset + field.length)).trimzero().trim();
                        val = parseInt(val);
                        break;
                    case 'L':
                        val = td.decode(dv.buffer.slice(dv.byteOffset + field.offset, dv.byteOffset + field.offset + field.length)).trimzero().trim();
                        val = ['Y', 'y', 'T', 't'].indexOf(val) >= 0;
                        break;
                    default:
                        val = td.decode(dv.buffer.slice(dv.byteOffset + field.offset, dv.byteOffset + field.offset + field.length)).trimzero().trim();
                }
                attributes[name] = val;
            });
            _this.collection.push({
                rank: _this.rank,
                pos: _this.offset,
                len: _this.dbfheader.recordSize,
                properties: attributes,
                bbox: []
            });
            _this.rank += 1;
            //if (rank < this.count) { this.skip('dbf', 1, ()  => this.parseDbfData()); }
            _this.parseDbfData();
        });
    };
    return ShapefileDbfParser;
}(geofile_1.GeojsonBinaryParser));
exports.ShapefileDbfParser = ShapefileDbfParser;
var ShapefileShpParser = /** @class */ (function (_super) {
    __extends(ShapefileShpParser, _super);
    function ShapefileShpParser(filename) {
        var _this = _super.call(this, filename, geofile_1.GeofileFiletype.SHP, true) || this;
        _this.count = 0;
        _this.geomtype = ShpGeomType.NullShape;
        _this.eof();
        _this.parseShpHeader();
        return _this;
    }
    /** when end of feature reached reset current */
    ShapefileShpParser.prototype.eof = function () {
        if (this.current) {
            this.collection.push(this.current);
            this.count++;
        }
        this.current = { rank: 0, pos: 0, len: 0, properties: {}, bbox: [] };
    };
    ShapefileShpParser.prototype.parseShpHeader = function () {
        var _this = this;
        // Position Field           Value       Type        Order
        // Byte 0   File Code       9994        Integer     Big
        // Byte 4   Unused          0           Integer     Big
        // Byte 8   Unused          0           Integer     Big
        // Byte 12  Unused          0           Integer     Big
        // Byte 16  Unused          0           Integer     Big
        // Byte 20  Unused          0           Integer     Big
        // Byte 24  File Length     File Length Integer     Big
        // Byte 28  Version         1000        Integer     Little
        // Byte 32  Shape Type      Shape Type  Integer     Little
        // Byte 36  Bounding Box    Xmin        Double      Little
        // Byte 44  Bounding Box    Ymin        Double      Little
        // Byte 52  Bounding Box    Xmax        Double      Little
        // Byte 60  Bounding Box    Ymax        Double      Little
        // Byte 68* Bounding Box    Zmin        Double      Little (if 0.0 not used)
        // Byte 76* Bounding Box    Zmax        Double      Little (if 0.0 not used)
        // Byte 84* Bounding Box    Mmin        Double      Little (if 0.0 not used)
        // Byte 92* Bounding Box    Mmax        Double      Little (if 0.0 not used)
        this.wait(100, function (dv) {
            _this.shpheader = {
                length: dv.getInt32(24) * 2,
                geomtype: dv.getInt32(32, true),
                xmin: dv.getFloat64(36, true),
                ymin: dv.getFloat64(44, true),
                xmax: dv.getFloat64(52, true),
                ymax: dv.getFloat64(60, true)
            };
            _this.parseShpGeom();
        });
    };
    ShapefileShpParser.prototype.parseShpGeom = function () {
        var _this = this;
        // Position Field           Value           Type    Number  Order
        // Byte 0   Record Number   Record Number   Integer 1       Big
        // Byte 4   Content Length  Content Length  Integer 1       Big
        // Byte 8   Shape Type      Shape Type      Integer 1       Little
        if (this.read >= this.shpheader.length) {
            return;
        }
        this.wait(12, function (dv) {
            _this.current.pos = _this.offset + 8;
            _this.current.rank = _this.count;
            _this.current.len = dv.getInt32(4) * 2;
            var type = dv.getInt32(8, true);
            switch (type) {
                case ShpGeomType.NullShape: return _this.parseShpGeom();
                case ShpGeomType.Point: return _this.parseShpPoint(_this.current.len - 4);
                case ShpGeomType.PointM: return _this.parseShpPoint(_this.current.len - 4);
                case ShpGeomType.PointZ: return _this.parseShpPoint(_this.current.len - 4);
                default: return _this.parseShpNotPoint();
            }
        });
    };
    ShapefileShpParser.prototype.parseShpPoint = function (len) {
        var _this = this;
        // Position Field       Value   Type    Number  Order
        // Byte 0   X           X       Double  1       Little
        // Byte 8   Y           Y       Double  1       Little
        this.wait(len, function (dv) {
            var x = dv.getFloat64(0, true);
            var y = dv.getFloat64(8, true);
            _this.current.bbox = [x, y, x, y];
            _this.eof();
            _this.parseShpGeom();
        });
    };
    ShapefileShpParser.prototype.parseShpNotPoint = function () {
        var _this = this;
        // Position Field       Value   Type    Number  Order
        // Byte 0   Box         Box     Double  4       Little
        // Byte 32        ... geometry remainder...
        this.wait(32, function (dv) {
            var xmin = dv.getFloat64(0, true);
            var ymin = dv.getFloat64(8, true);
            var xmax = dv.getFloat64(16, true);
            var ymax = dv.getFloat64(24, true);
            _this.current.bbox = [xmin, ymin, xmax, ymax];
            var remainder = _this.current.len - 36; //  len - type - bbox
            //console.log(JSON.stringify(this.current));
            _this.eof();
            _this.skip(remainder, function () { return _this.parseShpGeom(); });
        });
    };
    return ShapefileShpParser;
}(geofile_1.GeojsonBinaryParser));
exports.ShapefileShpParser = ShapefileShpParser;
//# sourceMappingURL=shapefile.js.map