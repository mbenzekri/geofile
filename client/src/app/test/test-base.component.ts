import { Component, OnInit, ChangeDetectorRef } from '@angular/core';



interface TestStruct {
    method: Function;
    should: string;
    result?: any|any[];
    expected?: any|any[];
    success?: boolean ;
}

@Component({
    // tslint:disable-next-line:component-selector
    selector: 'test-base',
    templateUrl: './test-base.component.html',
    styleUrls: ['./test-base.component.css']
})

export class TestBaseComponent implements OnInit {
    ref: ChangeDetectorRef;
    tests: TestStruct[] = [];
    current: number|null = null;
    title: '<override this title in subclasses>';

    constructor(private aref: ChangeDetectorRef) {
        this.ref = aref;
    }

    ngOnInit() {
        const testloop = (i = 0) => {
            if (i < this.tests.length) {
                const test = this.tests[i];
                this.current = i;
                test.method.call(this).catch(this.error()).finally(() => {
                    // this.ref.markForCheck();
                    this.current = null; testloop(++i);
                });
            }
        };
        testloop();
    }
    addTest(test: TestStruct) {
        this.tests.push(test);
    }
    is(testname: string) {
        return this.tests[this.current] && this.tests[this.current].method.name === testname;
    }
    get(testname: string) {
        return this.tests.find(test => test.method.name === testname);
    }
    error() {
        return (e: Error) => {
            const test = this.tests[this.current];
            test.success = false;
            test.result = e.message;
        };
    }
    success(expected?: any[] | any) {
        return (result: any[] | any) => {
            if (!Array.isArray(result)) { result = [result]; }
            if (!Array.isArray(expected)) { expected = [expected]; }
            const test = this.tests[this.current];
            test.success = (expected.length === result.length)
                && expected.every((item) => result.includes(item))
                && result.every((item) => expected.includes(item));
            if (!test.success) { throw new Error(`found ${JSON.stringify(result)} instead of  ${JSON.stringify(expected)}`); }
            test.result = result;
            test.expected = expected;
        };
    }
    debug() {
        console.log('not this coucou');
    }

}
