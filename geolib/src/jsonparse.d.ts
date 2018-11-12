

//export = Parser;

/*~ Write your module's methods and properties in this class */
export declare class Parser {
    offset:number;
    constructor();
    onError(e: Error):void;
    onValue(value: any): void;
    function (token: number, value: string);
    write(chunk: string | Buffer) :void;  
}
