var BezierJs;
(function (BezierJs) {
    "use strict";
    /**
     * Poly Bezier
     * @param {[type]} curves [description]
     */
    var PolyBezier = (function () {
        function PolyBezier(curves) {
            this.curves = curves;
            this.curves = [];
            this._3d = false;
            if (!!curves) {
                this.curves = curves;
                this._3d = this.curves[0]._3d;
            }
        }
        PolyBezier.prototype.valueOf = function () {
            return this.toString();
        };
        PolyBezier.prototype.toString = function () {
            return BezierJs.utils.pointsToString(this.points);
        };
        PolyBezier.prototype.addCurve = function (curve) {
            this.curves.push(curve);
            this._3d = this._3d || curve._3d;
        };
        PolyBezier.prototype.length = function () {
            return this.curves.map(function (v) { return v.length(); }).reduce(function (a, b) { return a + b; });
        };
        PolyBezier.prototype.curve = function (idx) {
            return this.curves[idx];
        };
        PolyBezier.prototype.bbox = function () {
            var c = this.curves;
            var bbox = c[0].bbox();
            for (var i = 1; i < c.length; i++) {
                BezierJs.utils.expandbox(bbox, c[i].bbox());
            }
            return bbox;
        };
        PolyBezier.prototype.offset = function (d) {
            var offset = [];
            this.curves.forEach(function (v) {
                offset = offset.concat(v.offset(d));
            });
            return new PolyBezier(offset);
        };
        return PolyBezier;
    })();
    BezierJs.PolyBezier = PolyBezier;
})(BezierJs || (BezierJs = {}));
//# sourceMappingURL=poly-bezier.js.map