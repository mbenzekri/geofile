import Parser from './jsonparse';
import { GeofileParser, GeofileFiletype } from './geofile';

export class GeojsonParser extends Parser implements GeofileParser {
    // implements GeofileParser
    type = GeofileFiletype.GEOJSON;
    collection = [];
    mandatory = true;
    filename: string;
    mdate: Date;

    private rank = 0;
    private brace = 0;
    private features = { rank: -1, reached: false, begin: 0, end: 0};
    private properties = { reached: false, value: '' };
    private geometry = { reached: false, value: '' };

    constructor(filename: string) {
        super();
        this.filename = filename;
    }

    // send data to jsonparse
    onData(buffer: ArrayBuffer) {
        this.write(Buffer.from(buffer));
    }

    onToken(token: number, value: any) {
        const LEFT_BRACE = 0x1;
        const RIGHT_BRACE = 0x2;
        const STRING = 0xa;
        const NUMBER = 0xb;
        if (token === LEFT_BRACE) { this.brace += 1; }
        if (token === RIGHT_BRACE) { this.brace -= 1; }
        if (value === 'features') { this.features.reached = true; }
        if (!this.features.reached) { return; }

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
            const geometry = <any>JSON.parse(this.geometry.value);
            const getbbox = (arr: any[], bounds = [null, null, null, null] ):  number[] =>  {
                if (! Array.isArray(arr)) { return bounds; }
                if (arr.length === 2 && typeof arr[0] === 'number' && typeof arr[0] === 'number') {
                    this.extend(bounds, arr);
                    return bounds;
                }
                arr.forEach((item) => getbbox(item, bounds));
                return bounds;
            };
            const feature = {
                rank: this.features.rank,
                pos: this.features.begin,
                len: this.features.end + 1 - this.features.begin,
                properties: <object>JSON.parse(this.properties.value),
                bbox: getbbox(geometry.coordinates)
            };
            // console.log(JSON.stringify(feature));
            this.features = { rank: -1, reached: true, begin: 0, end: 0};
            this.properties = { reached: false, value: '' };
            this.geometry = { reached: false, value: '' };
            this.collection.push(feature);
        }
        if (token === STRING && value === 'geometry' && this.brace === 2) { this.geometry.reached = true; }
        if (token === STRING && value === 'properties' && this.brace === 2) {this.properties.reached = true; }
    }
    extend (bounds: number[], point: number[]) {
        if (bounds[0] == null || point[0] < bounds[0]) { bounds[0] = point[0]; }
        if (bounds[1] == null || point[1] < bounds[1]) { bounds[1] = point[1]; }
        if (bounds[2] == null || point[0] > bounds[2]) { bounds[2] = point[0]; }
        if (bounds[3] == null || point[1] > bounds[3]) { bounds[3] = point[1]; }
    }
}
