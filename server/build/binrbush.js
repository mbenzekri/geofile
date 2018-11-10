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
Object.defineProperty(exports, "__esModule", { value: true });
var rbush = require('./rbush');
// tslint:disable-next-line:class-name
var binrbush = /** @class */ (function (_super) {
    __extends(binrbush, _super);
    function binrbush() {
        return _super.call(this, binrbush.RTREE_CHILD_MAX) || this;
    }
    binrbush.prototype.toBinary = function () {
        var node = this.toJSON();
        var buflen = binrbush.NODE_SIZE * this.nodeCount(node);
        var dv = new DataView(new ArrayBuffer(buflen));
        this.write(dv, node, 0);
        return dv.buffer;
    };
    binrbush.prototype.nodeCount = function (node) {
        var _this = this;
        return 1 + (node.leaf
            ? node.children.length
            : node.children.reduce(function (prev, cur) { return prev + _this.nodeCount(cur); }, 0));
    };
    binrbush.prototype.write = function (dv, node, pos) {
        var _this = this;
        pos = this.writeNode(dv, node, pos);
        if (node.leaf) {
            pos = node.children.reduce(function (prev, cur) { return _this.writeCluster(dv, cur, prev); }, pos);
        }
        else {
            pos = node.children.reduce(function (prev, cur, idx, arr) {
                var next = _this.write(dv, cur, prev);
                if (idx < (arr.length - 1)) {
                    dv.setUint32(prev + 21, next);
                }
                return next;
            }, pos);
        }
        return pos;
    };
    binrbush.prototype.writeNode = function (dv, node, pos) {
        // console.log("Writing node [",pos,"]:");
        dv.setUint8(pos, node.height);
        dv.setFloat32(pos + 1, node.bbox[0]);
        dv.setFloat32(pos + 5, node.bbox[1]);
        dv.setFloat32(pos + 9, node.bbox[2]);
        dv.setFloat32(pos + 13, node.bbox[3]);
        dv.setUint32(pos + 17, pos + binrbush.NODE_SIZE); // first child
        dv.setUint32(pos + 21, 0); // next brother
        return pos += binrbush.NODE_SIZE;
    };
    binrbush.prototype.writeCluster = function (dv, leaf, pos) {
        // console.log("Writing leaf [",pos,"]: ");
        dv.setUint8(pos, 0);
        dv.setFloat32(pos + 1, leaf[0]); // xmin BBOX
        dv.setFloat32(pos + 5, leaf[1]); // ymin BBOX
        dv.setFloat32(pos + 9, leaf[2]); // xmax BBOX
        dv.setFloat32(pos + 13, leaf[3]); // ymax BBOX
        dv.setUint32(pos + 17, leaf[4]); // rank number of the feature
        dv.setUint32(pos + 21, leaf[5]); // feature count
        return pos += binrbush.NODE_SIZE;
    };
    binrbush.prototype.dump = function (dv) {
        for (var pos = 0; pos < dv.byteLength; pos += binrbush.NODE_SIZE) {
            var height = dv.getUint8(pos);
            var xmin = dv.getFloat32(pos + 1); // xmin BBOX
            var ymin = dv.getFloat32(pos + 5); // ymin BBOX
            var xmax = dv.getFloat32(pos + 9); // xmax BBOX
            var ymax = dv.getFloat32(pos + 13); // ymax BBOX
            var leaf = (height === 1);
            var cluster = (height === 0);
            var node = (height > 1);
            var child = dv.getUint32(pos + 17); // rank number of the feature
            var next = dv.getUint32(pos + 21); // feature count
            var rank = dv.getUint32(pos + 17); // rank number of the feature
            var count = dv.getUint32(pos + 21); // feature count
            switch (height) {
                case 0:
                    console.log('%s clst : H=%s BBOX[%s,%s,%s,%s] rank=%s count=%s ', pos, height, xmin, ymin, xmax, ymax, rank, count);
                    break;
                case 1:
                    console.log('%s leaf : H=%s BBOX[%s,%s,%s,%s] first=%s next=%s ', pos, height, xmin, ymin, xmax, ymax, child, next);
                    break;
                default:
                    console.log('%s node : H=%s BBOX[%s,%s,%s,%s] child=%s next=%s ', pos, height, xmin, ymin, xmax, ymax, child, next);
            }
        }
    };
    binrbush.RTREE_CHILD_MAX = 20;
    binrbush.NODE_SIZE = 25;
    return binrbush;
}(rbush));
exports.binrbush = binrbush;
//# sourceMappingURL=binrbush.js.map