"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var jsonparse_1 = __importDefault(require("./jsonparse"));
var geofile_1 = require("./geofile");
var GeojsonParser = /** @class */ (function (_super) {
    __extends(GeojsonParser, _super);
    function GeojsonParser(filename) {
        var _this = _super.call(this) || this;
        // implements GeofileParser
        _this.type = geofile_1.GeofileFiletype.GEOJSON;
        _this.collection = [];
        _this.mandatory = true;
        _this.rank = 0;
        _this.brace = 0;
        _this.features = { rank: -1, reached: false, begin: 0, end: 0 };
        _this.properties = { reached: false, value: '' };
        _this.geometry = { reached: false, value: '' };
        _this.filename = filename;
        return _this;
    }
    // send data to jsonparse
    GeojsonParser.prototype.onData = function (buffer) {
        this.write(Buffer.from(buffer));
    };
    GeojsonParser.prototype.onToken = function (token, value) {
        var _this = this;
        var LEFT_BRACE = 0x1;
        var RIGHT_BRACE = 0x2;
        var STRING = 0xa;
        var NUMBER = 0xb;
        if (token === LEFT_BRACE) {
            this.brace += 1;
        }
        if (token === RIGHT_BRACE) {
            this.brace -= 1;
        }
        if (value === 'features') {
            this.features.reached = true;
        }
        if (!this.features.reached) {
            return;
        }
        if (this.properties.reached && this.brace > 2) {
            this.properties.value += (token === STRING) ? ('"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '" ') : (value + ' ');
        }
        if (this.geometry.reached && this.brace > 2) {
            this.geometry.value += (token === STRING) ? ('"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '" ') : (value + ' ');
        }
        if (this.properties.reached && token === RIGHT_BRACE && this.brace === 2) {
            this.properties.reached = false;
            this.properties.value += '}';
        }
        if (this.geometry.reached && token === RIGHT_BRACE && this.brace === 2) {
            this.geometry.reached = false;
            this.geometry.value += '}';
        }
        // opening brace for a feature, initializing
        if (token === LEFT_BRACE && this.brace === 2) {
            this.features.begin = this.offset;
            this.features.rank = this.rank++;
        }
        // closing brace for a feature add the feature to the feature list
        if (token === RIGHT_BRACE && this.brace === 1) {
            this.features.end = this.offset;
            // tslint:disable-next-line:max-line-length
            // console.log(`features at [${this.features.begin}, ${this.features.end}] len=${this.features.end - this.features.begin}`);
            // calculate bbox
            var geometry = JSON.parse(this.geometry.value);
            var getbbox_1 = function (arr, bounds) {
                if (bounds === void 0) { bounds = [null, null, null, null]; }
                if (!Array.isArray(arr)) {
                    return bounds;
                }
                if (arr.length === 2 && typeof arr[0] === 'number' && typeof arr[0] === 'number') {
                    _this.extend(bounds, arr);
                    return bounds;
                }
                arr.forEach(function (item) { return getbbox_1(item, bounds); });
                return bounds;
            };
            var feature = {
                rank: this.features.rank,
                pos: this.features.begin,
                len: this.features.end + 1 - this.features.begin,
                properties: JSON.parse(this.properties.value),
                bbox: getbbox_1(geometry.coordinates)
            };
            // console.log(JSON.stringify(feature));
            this.features = { rank: -1, reached: true, begin: 0, end: 0 };
            this.properties = { reached: false, value: '' };
            this.geometry = { reached: false, value: '' };
            this.collection.push(feature);
        }
        if (token === STRING && value === 'geometry' && this.brace === 2) {
            this.geometry.reached = true;
        }
        if (token === STRING && value === 'properties' && this.brace === 2) {
            this.properties.reached = true;
        }
    };
    GeojsonParser.prototype.extend = function (bounds, point) {
        if (bounds[0] == null || point[0] < bounds[0]) {
            bounds[0] = point[0];
        }
        if (bounds[1] == null || point[1] < bounds[1]) {
            bounds[1] = point[1];
        }
        if (bounds[2] == null || point[0] > bounds[2]) {
            bounds[2] = point[0];
        }
        if (bounds[3] == null || point[1] > bounds[3]) {
            bounds[3] = point[1];
        }
    };
    return GeojsonParser;
}(jsonparse_1.default));
exports.GeojsonParser = GeojsonParser;
//# sourceMappingURL=geojson.js.map