module BezierJs {

    "use strict";

    /**
     * Poly Bezier
     * @param {[type]} curves [description]
     */
    export class PolyBezier {
        private _3d: boolean;
        public points: Point[];

        constructor(public curves: Bezier[]) {
            this.curves = [];
            this._3d = false;
            if (!!curves) {
                this.curves = curves;
                this._3d = this.curves[0]._3d;
            }
        }

        public valueOf() {
            return this.toString();
        }

        public toString() {
            return utils.pointsToString(this.points);
        }

        public addCurve(curve: Bezier) {
            this.curves.push(curve);
            this._3d = this._3d || curve._3d;
        }

        public length() {
            return this.curves.map(function (v) { return v.length(); }).reduce(function (a, b) { return a + b; });
        }

        public curve(idx: number) {
            return this.curves[idx];
        }

        public bbox() {
            var c = this.curves;
            var bbox = c[0].bbox();
            for (var i = 1; i < c.length; i++) {
                utils.expandbox(bbox, c[i].bbox());
            }
            return bbox;
        }

        public offset(d: number) {
            var offset = [];
            this.curves.forEach(function (v: Bezier) {
                offset = offset.concat(v.offset(d) as Bezier[]);
            });
            return new PolyBezier(offset);
        }

    }

}