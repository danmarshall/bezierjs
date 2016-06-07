/**
  A javascript Bezier curve library by Pomax.

  Based on http://pomax.github.io/bezierinfo

  This code is MIT licensed.
**/

module BezierJs {

    "use strict";

    export interface Point {
        x: number;
        y: number;
        z?: number;
    }

    export interface Projection extends Point {
        t?: number;
        d?: number;
    }

    export interface Inflection {
        x: number[];
        y: number[];
        z?: number[];
        values: number[];
    }

    export interface Offset extends Point {
        c: Point;
        n: Point;
    }

    export interface Pair {
        left: Bezier;
        right: Bezier;
    }

    export interface Split extends Pair {
        span: Point[];
        _t1?: number;
        _t2?: number;
    }

    export interface MinMax {
        min: number;
        mid?: number;
        max: number;
        size?: number;
    }

    export interface BBox {
        x: MinMax;
        y: MinMax;
        z?: MinMax;
    }

    export interface Line {
        p1: Point;
        p2: Point;
    }

    export interface Arc extends Point {
        e: number;
        r: number;
        s: number;
    }

    export interface Shape {
        startcap: BezierCap;
        forward: Bezier;
        back: Bezier;
        endcap: BezierCap;
        bbox: BBox;
    }

    export interface ABC {
        A: Point;
        B: Point;
        C: Point;
    }

    export interface Closest {
        mdist: number;
        mpos: number;
    }

    // math-inlining.
    var abs = Math.abs,
        min = Math.min,
        max = Math.max,
        acos = Math.acos,
        sqrt = Math.sqrt,
        pi = Math.PI,
        // a zero coordinate, which is surprisingly useful
        ZERO = { x: 0, y: 0, z: 0 };

    /**
     * Bezier curve constructor. The constructor argument can be one of three things:
     *
     * 1. array/4 of {x:..., y:..., z:...}, z optional
     * 2. numerical array/8 ordered x1,y1,x2,y2,x3,y3,x4,y4
     * 3. numerical array/12 ordered x1,y1,z1,x2,y2,z2,x3,y3,z3,x4,y4,z4
     *
     */
    export class Bezier {

        private _linear: boolean;

        public clockwise: boolean;
        public _3d: boolean;
        public _t1: number;
        public _t2: number;
        public _lut: Point[] = [];

        public dpoints: Point[][];
        public order: number;
        public points: Point[];
        public dims: string[];
        public dimlen: number;

        constructor(points: Point[]);
        constructor(coords: number[]);
        constructor(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4?: number, y4?: number);
        constructor(p1: Point, p2: Point, p3: Point, p4?: Point);
        constructor(coords: any) {
            var args = (coords && coords.forEach) ? coords : [].slice.call(arguments);
            var coordlen: number;
            if (typeof args[0] === "object") {
                coordlen = args.length;
                var newargs = [];
                args.forEach(function (point) {
                    ['x', 'y', 'z'].forEach(function (d) {
                        if (typeof point[d] !== "undefined") {
                            newargs.push(point[d]);
                        }
                    });
                });
                args = newargs;
            }
            var higher = false;
            var len = args.length;
            if (coordlen) {
                if (coordlen > 4) {
                    if (arguments.length !== 1) {
                        throw new Error("Only new Bezier(point[]) is accepted for 4th and higher order curves");
                    }
                    higher = true;
                }
            } else {
                if (len !== 6 && len !== 8 && len !== 9 && len !== 12) {
                    if (arguments.length !== 1) {
                        throw new Error("Only new Bezier(point[]) is accepted for 4th and higher order curves");
                    }
                }
            }
            var _3d = (!higher && (len === 9 || len === 12)) || (coords && coords[0] && typeof coords[0].z !== "undefined");
            this._3d = _3d;
            var points: Point[] = [];
            for (var idx = 0, step = (_3d ? 3 : 2); idx < len; idx += step) {
                var point: Point = {
                    x: args[idx],
                    y: args[idx + 1]
                };
                if (_3d) { point.z = args[idx + 2] };
                points.push(point);
            }
            this.order = points.length - 1;
            this.points = points;
            var dims = ['x', 'y'];
            if (_3d) dims.push('z');
            this.dims = dims;
            this.dimlen = dims.length;
            (function (curve) {
                var a = utils.align(points, { p1: points[0], p2: points[curve.order] });
                for (var i = 0; i < a.length; i++) {
                    if (abs(a[i].y) > 0.0001) {
                        curve._linear = false;
                        return;
                    }
                }
                curve._linear = true;
            } (this));
            this._t1 = 0;
            this._t2 = 1;
            this.update();
        }

        static fromSVG(svgString: string) {
            var list: number[] = svgString.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g).map(parseFloat);
            var relative = /[cq]/.test(svgString);
            if (!relative) return new Bezier(list);
            list = list.map(function (v, i) {
                return i < 2 ? v : v + list[i % 2];
            });
            return new Bezier(list);
        }

        static getABC(n: number, S: Point, B: Point, E: Point, t: number): ABC {
            if (typeof t === "undefined") { t = 0.5; }
            var u = utils.projectionratio(t, n),
                um = 1 - u,
                C: Point = {
                    x: u * S.x + um * E.x,
                    y: u * S.y + um * E.y
                },
                s = utils.abcratio(t, n),
                A: Point = {
                    x: B.x + (B.x - C.x) / s,
                    y: B.y + (B.y - C.y) / s
                };
            return { A: A, B: B, C: C };
        }

        static quadraticFromPoints(p1: Point, p2: Point, p3: Point, t: number) {
            if (typeof t === "undefined") { t = 0.5; }
            // shortcuts, although they're really dumb
            if (t === 0) { return new Bezier(p2, p2, p3); }
            if (t === 1) { return new Bezier(p1, p2, p2); }
            // real fitting.
            var abc = Bezier.getABC(2, p1, p2, p3, t);
            return new Bezier(p1, abc.A, p3);
        }

        static cubicFromPoints(S: Point, B: Point, E: Point, t: number, d1: number) {
            if (typeof t === "undefined") { t = 0.5; }
            var abc = Bezier.getABC(3, S, B, E, t);
            if (typeof d1 === "undefined") { d1 = utils.dist(B, abc.C); }
            var d2 = d1 * (1 - t) / t;

            var selen = utils.dist(S, E),
                lx = (E.x - S.x) / selen,
                ly = (E.y - S.y) / selen,
                bx1 = d1 * lx,
                by1 = d1 * ly,
                bx2 = d2 * lx,
                by2 = d2 * ly;
            // derivation of new hull coordinates
            var e1 = { x: B.x - bx1, y: B.y - by1 },
                e2 = { x: B.x + bx2, y: B.y + by2 },
                A = abc.A,
                v1: Point = { x: A.x + (e1.x - A.x) / (1 - t), y: A.y + (e1.y - A.y) / (1 - t) },
                v2: Point = { x: A.x + (e2.x - A.x) / (t), y: A.y + (e2.y - A.y) / (t) },
                nc1: Point = { x: S.x + (v1.x - S.x) / (t), y: S.y + (v1.y - S.y) / (t) },
                nc2: Point = { x: E.x + (v2.x - E.x) / (1 - t), y: E.y + (v2.y - E.y) / (1 - t) };
            // ...done
            return new Bezier(S, nc1, nc2, E);
        };

        static getUtils() {
            return utils;
        }

        public getUtils() {
            return utils;
        }

        public valueOf() {
            return this.toString();
        }

        public toString() {
            return utils.pointsToString(this.points);
        }

        public toSVG() {
            if (this._3d) return '';
            var p = this.points,
                x = p[0].x,
                y = p[0].y,
                s = ["M", x, y, (this.order === 2 ? "Q" : "C")];
            for (var i = 1, last = p.length; i < last; i++) {
                s.push(p[i].x);
                s.push(p[i].y);
            }
            return s.join(" ");
        }

        public update() {
            // one-time compute derivative coordinates
            this.dpoints = [];
            for (var p = this.points, d = p.length, c = d - 1; d > 1; d-- , c--) {
                var list: Point[] = [];
                for (var j = 0, dpt: Point; j < c; j++) {
                    dpt = {
                        x: c * (p[j + 1].x - p[j].x),
                        y: c * (p[j + 1].y - p[j].y)
                    };
                    if (this._3d) {
                        dpt.z = c * (p[j + 1].z - p[j].z);
                    }
                    list.push(dpt);
                }
                this.dpoints.push(list);
                p = list;
            }
            this.computedirection();
        }

        public computedirection() {
            var points = this.points;
            var angle = utils.angle(points[0], points[this.order], points[1]);
            this.clockwise = angle > 0;
        }

        public length() {
            return utils.length(this.derivative.bind(this));
        }

        public getLUT(steps?: number) {
            steps = steps || 100;
            if (this._lut.length === steps) { return this._lut; }
            this._lut = [];
            for (var t = 0; t <= steps; t++) {
                this._lut.push(this.compute(t / steps));
            }
            return this._lut;
        }

        public on(point: Point, error: number) {
            error = error || 5;
            var lut = this.getLUT(), hits = [], c, t = 0;
            for (var i = 0; i < lut.length; i++) {
                c = lut[i];
                if (utils.dist(c, point) < error) {
                    hits.push(c)
                    t += i / lut.length;
                }
            }
            if (!hits.length) return 0;
            return t /= hits.length;
        }

        public project(point: Point): Projection {
            // step 1: coarse check
            var LUT = this.getLUT(), l = LUT.length - 1,
                closest = utils.closest(LUT, point),
                mdist = closest.mdist,
                mpos = closest.mpos;
            if (mpos === 0 || mpos === l) {
                let t = mpos / l, pt: Projection = this.compute(t);
                pt.t = t;
                pt.d = mdist;
                return pt;
            }

            // step 2: fine check
            var ft, t, p, d,
                t1 = (mpos - 1) / l,
                t2 = (mpos + 1) / l,
                step = 0.1 / l;
            mdist += 1;
            for (t = t1, ft = t; t < t2 + step; t += step) {
                p = this.compute(t);
                d = utils.dist(point, p);
                if (d < mdist) {
                    mdist = d;
                    ft = t;
                }
            }
            p = this.compute(ft);
            p.t = ft;
            p.d = mdist;
            return p;
        }

        public get(t: number) {
            return this.compute(t);
        }

        public point(idx: number) {
            return this.points[idx];
        }

        public compute(t: number): Point {
            // shortcuts
            if (t === 0) { return this.points[0]; }
            if (t === 1) { return this.points[this.order]; }

            var p = this.points;
            var mt = 1 - t;
            var ret: Point;

            // linear?
            if (this.order === 1) {
                ret = {
                    x: mt * p[0].x + t * p[1].x,
                    y: mt * p[0].y + t * p[1].y
                };
                if (this._3d) { ret.z = mt * p[0].z + t * p[1].z; }
                return ret;
            }

            // quadratic/cubic curve?
            if (this.order < 4) {
                var mt2 = mt * mt,
                    t2 = t * t,
                    a, b, c, d = 0;
                if (this.order === 2) {
                    p = [p[0], p[1], p[2], ZERO];
                    a = mt2;
                    b = mt * t * 2;
                    c = t2;
                }
                else if (this.order === 3) {
                    a = mt2 * mt;
                    b = mt2 * t * 3;
                    c = mt * t2 * 3;
                    d = t * t2;
                }
                ret = {
                    x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x,
                    y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y
                };
                if (this._3d) {
                    ret.z = a * p[0].z + b * p[1].z + c * p[2].z + d * p[3].z;
                }
                return ret;
            }

            // higher order curves: use de Casteljau's computation
            var dCpts = JSON.parse(JSON.stringify(this.points));
            while (dCpts.length > 1) {
                for (var i = 0; i < dCpts.length - 1; i++) {
                    dCpts[i] = {
                        x: dCpts[i].x + (dCpts[i + 1].x - dCpts[i].x) * t,
                        y: dCpts[i].y + (dCpts[i + 1].y - dCpts[i].y) * t
                    };
                    if (typeof dCpts[i].z !== "undefined") {
                        dCpts[i] = dCpts[i].z + (dCpts[i + 1].z - dCpts[i].z) * t
                    }
                }
                dCpts.splice(dCpts.length - 1, 1);
            }
            return dCpts[0];
        }

        public raise() {
            var p = this.points, np = [p[0]], k = p.length, pi, pim;
            for (var i = 1; i < k; i++) {
                pi = p[i];
                pim = p[i - 1];
                np[i] = {
                    x: (k - i) / k * pi.x + i / k * pim.x,
                    y: (k - i) / k * pi.y + i / k * pim.y
                };
            }
            np[k] = p[k - 1];
            return new Bezier(np);
        }

        public derivative(t: number) {
            var mt = 1 - t,
                a, b, c = 0,
                p = this.dpoints[0];
            if (this.order === 2) { p = [p[0], p[1], ZERO]; a = mt; b = t; }
            if (this.order === 3) { a = mt * mt; b = mt * t * 2; c = t * t; }
            var ret: Point = {
                x: a * p[0].x + b * p[1].x + c * p[2].x,
                y: a * p[0].y + b * p[1].y + c * p[2].y
            };
            if (this._3d) {
                ret.z = a * p[0].z + b * p[1].z + c * p[2].z;
            }
            return ret;
        }

        public inflections() {
            return utils.inflections(this.points);
        }

        public normal(t: number) {
            return this._3d ? this.__normal3(t) : this.__normal2(t);
        }

        private __normal2(t: number): Point {
            var d = this.derivative(t);
            var q = sqrt(d.x * d.x + d.y * d.y)
            return { x: -d.y / q, y: d.x / q };
        }

        private __normal3(t: number): Point {
            throw 'not implemented';
        }

        private __normal(t: number) {
            // see http://stackoverflow.com/questions/25453159
            var r1 = this.derivative(t),
                r2 = this.derivative(t + 0.01),
                q1 = sqrt(r1.x * r1.x + r1.y * r1.y + r1.z * r1.z),
                q2 = sqrt(r2.x * r2.x + r2.y * r2.y + r2.z * r2.z);
            r1.x /= q1; r1.y /= q1; r1.z /= q1;
            r2.x /= q2; r2.y /= q2; r2.z /= q2;
            // cross product
            var c = {
                x: r2.y * r1.z - r2.z * r1.y,
                y: r2.z * r1.x - r2.x * r1.z,
                z: r2.x * r1.y - r2.y * r1.x
            };
            var m = sqrt(c.x * c.x + c.y * c.y + c.z * c.z);
            c.x /= m; c.y /= m; c.z /= m;
            // rotation matrix
            var R = [c.x * c.x, c.x * c.y - c.z, c.x * c.z + c.y,
                c.x * c.y + c.z, c.y * c.y, c.y * c.z - c.x,
                c.x * c.z - c.y, c.y * c.z + c.x, c.z * c.z];
            // normal vector:
            var n = {
                x: R[0] * r1.x + R[1] * r1.y + R[2] * r1.z,
                y: R[3] * r1.x + R[4] * r1.y + R[5] * r1.z,
                z: R[6] * r1.x + R[7] * r1.y + R[8] * r1.z
            };
            return n;
        }

        public hull(t: number) {
            var p = this.points,
                _p: Point[] = [],
                pt: Point,
                q: Point[] = [],
                idx = 0,
                i = 0,
                l = 0;
            q[idx++] = p[0];
            q[idx++] = p[1];
            q[idx++] = p[2];
            if (this.order === 3) { q[idx++] = p[3]; }
            // we lerp between all points at each iteration, until we have 1 point left.
            while (p.length > 1) {
                _p = [];
                for (i = 0, l = p.length - 1; i < l; i++) {
                    pt = utils.lerp(t, p[i], p[i + 1]);
                    q[idx++] = pt;
                    _p.push(pt);
                }
                p = _p;
            }
            return q;
        }

        public split(t1: number): Split;
        public split(t1: number, t2: number): Bezier;
        public split(t1: number, t2?: number): Bezier | Split {
            // shortcuts
            if (t1 === 0 && !!t2) { return this.split(t2).left; }
            if (t2 === 1) { return this.split(t1).right; }

            // no shortcut: use "de Casteljau" iteration.
            var q = this.hull(t1);
            var result: Split = {
                left: this.order === 2 ? new Bezier([q[0], q[3], q[5]]) : new Bezier([q[0], q[4], q[7], q[9]]),
                right: this.order === 2 ? new Bezier([q[5], q[4], q[2]]) : new Bezier([q[9], q[8], q[6], q[3]]),
                span: q
            };

            // make sure we bind _t1/_t2 information!
            result.left._t1 = utils.map(0, 0, 1, this._t1, this._t2);
            result.left._t2 = utils.map(t1, 0, 1, this._t1, this._t2);
            result.right._t1 = utils.map(t1, 0, 1, this._t1, this._t2);
            result.right._t2 = utils.map(1, 0, 1, this._t1, this._t2);

            // if we have no t2, we're done
            if (!t2) { return result; }

            // if we have a t2, split again:
            t2 = utils.map(t2, t1, 1, 0, 1);
            var subsplit = result.right.split(t2);
            return subsplit.left;
        }

        public extrema() {
            var dims = this.dims,
                result: Inflection = { x: [], y: [], values: [] },
                roots: number[] = [],
                p, mfn;
            dims.forEach((dim: string) => {
                mfn = function (v: Point[]) {
                    return v[dim];
                };
                p = this.dpoints[0].map(mfn);
                result[dim] = utils.droots(p);
                if (this.order === 3) {
                    p = this.dpoints[1].map(mfn);
                    result[dim] = result[dim].concat(utils.droots(p));
                }
                result[dim] = result[dim].filter(function (t) { return (t >= 0 && t <= 1); });
                roots = roots.concat(result[dim].sort());
            });
            roots.sort();
            result.values = roots;
            return result;
        }

        public bbox() {
            var extrema = this.extrema(), result = {};
            this.dims.forEach((d: string) => {
                result[d] = utils.getminmax(this, d, extrema[d]);
            }, this);
            return result as BBox;
        }

        public overlaps(curve: Bezier) {
            var lbbox = this.bbox(),
                tbbox = curve.bbox();
            return utils.bboxoverlap(lbbox, tbbox);
        }

        public offset(t: number, d?: number): Offset | Bezier[] {
            if (typeof d !== "undefined") {
                var c = this.get(t);
                var n = this.normal(t);
                var ret: Offset = {
                    c: c,
                    n: n,
                    x: c.x + n.x * d,
                    y: c.y + n.y * d
                };
                if (this._3d) {
                    ret.z = c.z + n.z * d;
                };
                return ret;
            }
            if (this._linear) {
                var nv = this.normal(0);
                var coords = this.points.map(function (p) {
                    var ret: Point = {
                        x: p.x + t * nv.x,
                        y: p.y + t * nv.y
                    };
                    if (p.z && n.z) { ret.z = p.z + t * nv.z; }
                    return ret;
                });
                return [new Bezier(coords)];
            }
            var reduced = this.reduce() as Bezier[];
            return reduced.map(function (s: Bezier) {
                return s.scale(t);
            });
        }

        public simple() {
            if (this.order === 3) {
                var a1 = utils.angle(this.points[0], this.points[3], this.points[1]);
                var a2 = utils.angle(this.points[0], this.points[3], this.points[2]);
                if (a1 > 0 && a2 < 0 || a1 < 0 && a2 > 0) return false;
            }
            var n1 = this.normal(0);
            var n2 = this.normal(1);
            var s = n1.x * n2.x + n1.y * n2.y;
            if (this._3d) { s += n1.z * n2.z; }
            var angle = abs(acos(s));
            return angle < pi / 3;
        }

        public reduce() {
            var i, t1 = 0, t2 = 0, step = 0.01, segment: Split | Bezier, pass1 = [], pass2 = [];
            // first pass: split on extrema
            var extrema = this.extrema().values;
            if (extrema.indexOf(0) === -1) { extrema = [0].concat(extrema); }
            if (extrema.indexOf(1) === -1) { extrema.push(1); }
            for (t1 = extrema[0], i = 1; i < extrema.length; i++) {
                t2 = extrema[i];
                segment = this.split(t1, t2);
                segment._t1 = t1;
                segment._t2 = t2;
                pass1.push(segment);
                t1 = t2;
            }
            // second pass: further reduce these segments to simple segments
            pass1.forEach(function (p1: Bezier) {
                t1 = 0;
                t2 = 0;
                while (t2 <= 1) {
                    for (t2 = t1 + step; t2 <= 1 + step; t2 += step) {
                        segment = p1.split(t1, t2);
                        if (!(<Bezier>segment).simple()) {
                            t2 -= step;
                            if (abs(t1 - t2) < step) {
                                // we can never form a reduction
                                return [];
                            }
                            segment = p1.split(t1, t2);
                            segment._t1 = utils.map(t1, 0, 1, p1._t1, p1._t2);
                            segment._t2 = utils.map(t2, 0, 1, p1._t1, p1._t2);
                            pass2.push(segment);
                            t1 = t2;
                            break;
                        }
                    }
                }
                if (t1 < 1) {
                    segment = p1.split(t1, 1);
                    segment._t1 = utils.map(t1, 0, 1, p1._t1, p1._t2);
                    segment._t2 = p1._t2;
                    pass2.push(segment);
                }
            });
            return pass2;
        }

        public scale(d: Function): Bezier;
        public scale(d: number): Bezier;
        public scale(d: any): Bezier {
            var order = this.order;
            var distanceFn: (d: number) => number;
            if (typeof d === "function") { distanceFn = d; }
            if (distanceFn && order === 2) { return this.raise().scale(distanceFn); }

            // TODO: add special handling for degenerate (=linear) curves.
            var clockwise = this.clockwise;
            var r1 = distanceFn ? distanceFn(0) : d;
            var r2 = distanceFn ? distanceFn(1) : d;
            var v: Offset[] = [<Offset>this.offset(0, 10), <Offset>this.offset(1, 10)];
            var o = utils.lli4(v[0], v[0].c, v[1], v[1].c);
            if (!o) { throw "cannot scale this curve. Try reducing it first."; }
            // move all points by distance 'd' wrt the origin 'o'
            var points = this.points, np: Point[] = [];

            // move end points by fixed distance along normal.
            [0, 1].forEach(function (t) {
                var p: Point = np[t * order] = utils.copy(points[t * order]);
                p.x += (t ? r2 : r1) * v[t].n.x;
                p.y += (t ? r2 : r1) * v[t].n.y;
            }.bind(this));

            if (!distanceFn) {
                // move control points to lie on the intersection of the offset
                // derivative vector, and the origin-through-control vector
                [0, 1].forEach((t) => {
                    if (this.order === 2 && !!t) return;
                    var p = np[t * order];
                    var d = this.derivative(t);
                    var p2 = { x: p.x + d.x, y: p.y + d.y };
                    np[t + 1] = utils.lli4(p, p2, o, points[t + 1]);
                }, this);
                return new Bezier(np);
            }

            // move control points by "however much necessary to
            // ensure the correct tangent to endpoint".
            [0, 1].forEach((t) => {
                if (this.order === 2 && !!t) return;
                var p = points[t + 1];
                var ov = {
                    x: p.x - o.x,
                    y: p.y - o.y
                };
                var rc = distanceFn ? distanceFn((t + 1) / order) : d;
                if (distanceFn && !clockwise) rc = -rc;
                var m = sqrt(ov.x * ov.x + ov.y * ov.y);
                ov.x /= m;
                ov.y /= m;
                np[t + 1] = {
                    x: p.x + rc * ov.x,
                    y: p.y + rc * ov.y
                }
            }, this);
            return new Bezier(np);
        }

        public outline(d1: number, d2?: number, d3?: number, d4?: number) {
            d2 = (typeof d2 === "undefined") ? d1 : d2;
            var reduced = this.reduce() as Bezier[],
                len = reduced.length,
                fcurves = [],
                bcurves = [],
                p: Point,
                alen = 0,
                tlen = this.length();

            var graduated = (typeof d3 !== "undefined" && typeof d4 !== "undefined");

            function linearDistanceFunction(s, e, tlen, alen, slen) {
                return function (v) {
                    var f1 = alen / tlen, f2 = (alen + slen) / tlen, d = e - s;
                    return utils.map(v, 0, 1, s + f1 * d, s + f2 * d);
                };
            };

            // form curve oulines
            reduced.forEach(function (segment: Bezier) {
                slen = segment.length();
                if (graduated) {
                    fcurves.push(segment.scale(linearDistanceFunction(d1, d3, tlen, alen, slen)));
                    bcurves.push(segment.scale(linearDistanceFunction(-d2, -d4, tlen, alen, slen)));
                } else {
                    fcurves.push(segment.scale(d1));
                    bcurves.push(segment.scale(-d2));
                }
                alen += slen;
            });

            // reverse the "return" outline
            bcurves = bcurves.map(function (s) {
                p = s.points;
                if (p[3]) { s.points = [p[3], p[2], p[1], p[0]]; }
                else { s.points = [p[2], p[1], p[0]]; }
                return s;
            }).reverse();

            // form the endcaps as lines
            var fs = fcurves[0].points[0],
                fe = fcurves[len - 1].points[fcurves[len - 1].points.length - 1],
                bs = bcurves[len - 1].points[bcurves[len - 1].points.length - 1],
                be = bcurves[0].points[0],
                ls = utils.makeline(bs, fs),
                le = utils.makeline(fe, be),
                segments = [ls].concat(fcurves).concat([le]).concat(bcurves),
                slen = segments.length;

            return new PolyBezier(segments);
        }

        public outlineshapes(d1: number, d2: number) {
            d2 = d2 || d1;
            var outline = this.outline(d1, d2).curves;
            var shapes: Shape[] = [];
            for (var i = 1, len = outline.length; i < len / 2; i++) {
                var shape = utils.makeshape(outline[i], outline[len - i]);
                shape.startcap.virtual = (i > 1);
                shape.endcap.virtual = (i < len / 2 - 1);
                shapes.push(shape);
            }
            return shapes;
        }

        public intersects(curve: Bezier): string[] | number[];
        public intersects(curve: Line): string[] | number[];
        public intersects(item: any): string[] | number[] {
            if (!item) return this.selfintersects();
            var line = item as Line;
            if (line.p1 && line.p2) {
                return this.lineIntersects(line);
            }
            var curve: Bezier[];
            if (item instanceof Bezier) { curve = (<Bezier>item).reduce() as Bezier[]; }
            return this.curveintersects(this.reduce() as Bezier[], curve);
        }

        public lineIntersects(line: Line) {
            var mx = min(line.p1.x, line.p2.x),
                my = min(line.p1.y, line.p2.y),
                MX = max(line.p1.x, line.p2.x),
                MY = max(line.p1.y, line.p2.y),
                self = this;
            return utils.roots(this.points, line).filter(function (t) {
                var p = self.get(t);
                return utils.between(p.x, mx, MX) && utils.between(p.y, my, MY);
            });
        }

        public selfintersects() {
            var reduced = this.reduce();
            // "simple" curves cannot intersect with their direct
            // neighbour, so for each segment X we check whether
            // it intersects [0:x-2][x+2:last].
            var i, len = reduced.length - 2, results: string[] = [], result, left, right;
            for (i = 0; i < len; i++) {
                left = reduced.slice(i, i + 1);
                right = reduced.slice(i + 2);
                result = this.curveintersects(left, right);
                results = results.concat(result);
            }
            return results;
        }

        public curveintersects(c1: Bezier[], c2: Bezier[]) {
            var pairs = [];
            // step 1: pair off any overlapping segments
            c1.forEach(function (l) {
                c2.forEach(function (r) {
                    if (l.overlaps(r)) {
                        pairs.push({ left: l, right: r });
                    }
                });
            });
            // step 2: for each pairing, run through the convergence algorithm.
            var intersections: string[] = [];
            pairs.forEach(function (pair) {
                var result = utils.pairiteration(pair.left, pair.right);
                if (result.length > 0) {
                    intersections = intersections.concat(result);
                }
            });
            return intersections;
        }

        public arcs(errorThreshold?: number) {
            errorThreshold = errorThreshold || 0.5;
            var circles = [];
            return this._iterate(errorThreshold, circles);
        }

        private _error(pc: Point, np1: Point, s: number, e: number) {
            var q = (e - s) / 4,
                c1 = this.get(s + q),
                c2 = this.get(e - q),
                ref = utils.dist(pc, np1),
                d1 = utils.dist(pc, c1),
                d2 = utils.dist(pc, c2);
            return abs(d1 - ref) + abs(d2 - ref);
        }

        private _iterate(errorThreshold: number, circles: Arc[]) {
            var s = 0, e = 1, safety: number;
            // we do a binary search to find the "good `t` closest to no-longer-good"
            do {
                safety = 0;

                // step 1: start with the maximum possible arc
                e = 1;

                // points:
                var np1 = this.get(s), np2: Point, np3: Point, arc: Arc, prev_arc: Arc;

                // booleans:
                var curr_good = false, prev_good = false, done: boolean;

                // numbers:
                var m = e, prev_e = 1, step = 0;

                // step 2: find the best possible arc
                do {
                    prev_good = curr_good;
                    prev_arc = arc;
                    m = (s + e) / 2;
                    step++;

                    np2 = this.get(m);
                    np3 = this.get(e);

                    arc = utils.getccenter(np1, np2, np3);
                    var error = this._error(arc, np1, s, e);
                    curr_good = (error <= errorThreshold);

                    done = prev_good && !curr_good;
                    if (!done) prev_e = e;

                    // this arc is fine: we can move 'e' up to see if we can find a wider arc
                    if (curr_good) {
                        // if e is already at max, then we're done for this arc.
                        if (e >= 1) {
                            prev_e = 1;
                            prev_arc = arc;
                            break;
                        }
                        // if not, move it up by half the iteration distance
                        e = e + (e - s) / 2;
                    }

                    // this is a bad arc: we need to move 'e' down to find a good arc
                    else {
                        e = m;
                    }
                }
                while (!done && safety++ < 100);

                if (safety >= 100) {
                    console.error("arc abstraction somehow failed...");
                    break;
                }

                // console.log("[F] arc found", s, prev_e, prev_arc.x, prev_arc.y, prev_arc.s, prev_arc.e);

                prev_arc = (prev_arc ? prev_arc : arc);
                circles.push(prev_arc);
                s = prev_e;
            }
            while (e < 1);
            return circles;
        }
    }

    export class BezierCap extends Bezier {
        public virtual: boolean;
    }
}

module.exports = BezierJs;
