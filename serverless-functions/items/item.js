'use strict'

const https = require('https');
const uuid = require('uuid');
class Item {

    constructor(aliData) {

        let fromAliExpress, fromClient;

        if (typeof aliData !== "undefined") {
            fromAliExpress = typeof aliData.actionModule !== "undefined";
            fromClient = typeof aliData.id !== "undefined";
        } else {
            fromAliExpress = false;
            fromClient = false;
        }



        if (fromAliExpress) {
            this.id = aliData.actionModule.productId;
            this.name = aliData.titleModule.subject;
            this.price = aliData.priceModule.formatedActivityPrice;
            this.description = aliData.pageModule.description;
            let optionsFromNetwork = aliData.skuModule.productSKUPropertyList;
            this.options = optionsFromNetwork.map((p) => {

                let option = {};
                option.name = p.skuPropertyName;
                option.values = p.skuPropertyValues.map((v) => {

                    let value = {};
                    value.name = v.propertyValueDisplayName;
                    value.image = v.skuPropertyImagePath;
                    return value;

                })
                return option;
            }),
                this.images = aliData.imageModule.imagePathList

        } else if (fromClient) {
            this.id = aliData.id;
            this.name = aliData.name;
            this.price = aliData.price;
            this.description = aliData.description;
            this.options = aliData.options
            this.image = aliData.image;
        } else {


        }
    }
    // converts the loaded aliItem into a batch upsert body 
    toSquareItem() {

        let req = { "idempotency_key": uuid() };
        let objects = [];
        let object = {
            "type": "ITEM",
            "id": `#${this.name.replace(/\s/g, '-')}`,
        };
        let itemData = {
            "name": this.name,
            "description": this.description,
            "image": this.image,
        };
        if (this.options.length > 0) {
            let addOptions = this.options.map(v => {
                // uuid's are used because square options are universal in the backend
                // where in this case they need to be directly associated with the product 
                // for demonstration purposes. The standard #name resulted in many clashes.
                // Many of the tests were done on clothing which have same name SIZE but 
                // varied in range of sizes.
                let option = { id: `#${uuid()}`, type: "ITEM_OPTION" }
                // console.log("here is what it thinks values is: " +JSON.stringify(v.values));
                // create list of values that the option holds eg SIZE (ITEM_OPTION) holds S,M,L,XL (ITEM_OPTION_VAL)
                let values = v.values.map(w => {
                    // create the item option value to be added to values array within the options.
                    // console.log("here is what it thinks value is: " + JSON.stringify(w));
                    let info = {
                        id: `#${uuid()}`,
                        type: "ITEM_OPTION_VAL",
                        item_option_value_data: {
                            name: w.name
                        }
                    }
                    return info;
                });
                // insert name and option values into item_options_data
                option.item_option_data = { name: `${v.name} FOR: ${this.name}`, values: values, display_name: v.name };
                return option;
            })
            // spread the different options into batch upsert objects
            objects = [...addOptions];
            // append the options id to the actual item
            itemData.item_options = addOptions.map(opt => { return { "item_option_id": opt.id } });
        }
        // insert the item into the batch objects with the accompanying options and return 
        // the appropriate request body
        object.item_data = itemData;
        objects.push(object);
        req.batches = [{ objects: objects }];
        return req;
    }
}

const badPathResponse = {
    statusCode: 502,
    headers: {
        "Content-type": "application/json"
    },
    body: JSON.stringify({ message: "no item requested" })
}

const scrape = (data) => {
    try {
        // remove the dangling comma and all redundant stuff after and return
        let cleaned = data.match(/data: \{.*/g)[0].replace(/[\n\r]/g, '');
        return JSON.parse(cleaned.slice(6, cleaned.lastIndexOf('},') + 1));
    } catch (e) {
        // if Aliexpress schema changes will not crash but return JSON parsing error
        return e;
    }
}

exports.get = async (event, context, callback) => new Promise((resolve, reject) => {

    if (event.queryStringParameters == null) {
        resolve(badPathResponse);
    }
    if (event.queryStringParameters.item == null) {
        resolve(badPathResponse);
    }

    let itemId = event.queryStringParameters.item;

    const params = {
        host: "www.aliexpress.com",
        path: `/item/${itemId}.html`,
        port: 443,
        method: "GET",
    };

    const req = https.request(params, function (res) {
        let data = '';
        console.log('STATUS: ' + res.statusCode);
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            data += chunk;
        });
        res.on('end', function () {
            // console.log(scrape(data.toString()));
            let ali = new Item(scrape(data.toString()));
            if (ali == {}) {
                resolve({
                    
                });
            }
            // console.log(ali.toSquareItem());
            resolve({
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Credentials': true,
                },
                body: JSON.stringify(ali)
            });
        });
    }).on('error', (e) => resolve({
        statusCode: 501,
        headers: {
            "Content-type": "application/json"
        },
        body: JSON.stringify({ message: "request couldnt go thru" })
    }));

    req.end();

}).then((res) => callback(null, res));
module.exports.Item = Item;