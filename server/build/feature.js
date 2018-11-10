"use strict";
var Feature = function (layer, gpos, apos) {
    this.layer = layer;
    this.geompos = gpos;
    this.attrpos = apos;
};
Feature.prototype.getType = function () {
    return this.layer.geomData.readInt32LE(this.geompos + 0);
};
Feature.prototype.bboxInteract = function (xmin, ymin, xmax, ymax) {
    var fxmin = this.layer.geomData.readDoubleLE(this.geompos + 4);
    var fxmax = this.layer.geomData.readDoubleLE(this.geompos + 20);
    if (fxmin < xmin && fxmax < xmin)
        return false;
    if (fxmin > xmax && fxmax > xmax)
        return false;
    var fymin = this.layer.geomData.readDoubleLE(this.geompos + 12);
    var fymax = this.layer.geomData.readDoubleLE(this.geompos + 28);
    if (fymin < ymin && fymax < ymin)
        return false;
    if (fymin > ymax && fymax > ymax)
        return false;
    return true;
};
Feature.prototype.getBbox = function () {
    var fxmin = this.layer.geomData.readDoubleLE(this.geompos + 4);
    var fymin = this.layer.geomData.readDoubleLE(this.geompos + 12);
    var fxmax = fxmin;
    var fymax = fymin;
    if (this.getType() > Feature.TypeToCode.Point) {
        fxmax = this.layer.geomData.readDoubleLE(this.geompos + 20);
        fymax = this.layer.geomData.readDoubleLE(this.geompos + 28);
    }
    return [fxmin, fymin, fxmax, fymax];
};
Feature.TypeToCode = {
    NullShape: 0,
    Point: 1,
    PolyLine: 3,
    Polygon: 5,
    MultiPoint: 8,
    PointZ: 11,
    PolyLineZ: 13,
    PolygonZ: 15,
    MultiPointZ: 18,
    PointM: 21,
    PolyLineM: 23,
    PolygonM: 25,
    MultiPointM: 28,
    MultiPatch: 31
};
Feature.CodeToType = {};
for (var key in Feature.TypeToCode) {
    Feature.CodeToType[Feature.TypeToCode[key]] = key;
}
Feature.prototype.pointInteract = function (x, y) {
    var fxmin = this.layer.geomData.readDoubleLE(this.geompos + 4);
    var fxmax = this.layer.geomData.readDoubleLE(this.geompos + 20);
    if (x < fxmin || x > fxmax)
        return false;
    var fymin = this.layer.geomData.readDoubleLE(this.geompos + 12);
    var fymax = this.layer.geomData.readDoubleLE(this.geompos + 28);
    if (y < fymin || y > fymax)
        return false;
    return true;
};
// nombre d'anneau exterieur et interieur
Feature.prototype.ringCount = function () {
    return this.layer.geomData.readInt32LE(this.geompos + 36);
};
// nombre total de point 
Feature.prototype.pointCount = function () {
    return this.layer.geomData.readInt32LE(this.geompos + 40);
};
// position du tableau d'index des anneaux
Feature.prototype.ringIndex = function () {
    return this.geompos + 44;
};
// position du 1er point de tous les anneaux
Feature.prototype.pointStart = function () {
    return this.ringIndex() + 4 * this.ringCount();
};
// offset du 1er point d'un anneau a partir de pointStart()
Feature.prototype.ringPointOffset = function (i) {
    return 16 * this.layer.geomData.readInt32LE(this.ringIndex() + i * 4);
};
// position du premier point d'un anneau
Feature.prototype.ringPointStart = function (i) {
    return this.pointStart() + this.ringPointOffset(i);
};
// nombre de points d'un anneau
Feature.prototype.ringPointCount = function (i) {
    var deb = this.ringPointOffset(i);
    var fin = (i + 1 < this.ringCount()) ? this.ringPointOffset(i + 1) : 16 * this.pointCount();
    return Math.floor((fin - deb) / 16);
};
Feature.prototype.xPoint = function (ring, i) {
    var pos = this.ringPointStart(ring) + i * 16;
    return this.layer.geomData.readDoubleLE(pos);
};
Feature.prototype.yPoint = function (ring, i) {
    var pos = this.ringPointStart(ring) + i * 16;
    return this.layer.geomData.readDoubleLE(pos + 8);
};
Feature.prototype.toString = function () {
    return "rings=" + this.ringCount() + "points=" + this.pointCount() + "points0=" + this.ringPointCount(0);
};
Feature.prototype.getValue = function (attr) {
    var desc = this.layer.dbfheader.fields[attr];
    if (!desc)
        return null;
    var txt = this.layer.attrData.toString('utf8', this.attrpos + desc.offset, this.attrpos + desc.offset + desc.len).trim();
    if (desc.type === "C")
        return txt;
    if (desc.type === "N" && desc.decimal === 0)
        return parseInt(txt, 10);
    if (desc.type === "N" || desc.type === "F" || desc.type === "Y")
        return parseFloat(txt);
    if (desc.type === "L")
        return txt;
    // D => YYYYMMDD
    return txt;
};
exports.Feature = Feature;
//# sourceMappingURL=feature.js.map