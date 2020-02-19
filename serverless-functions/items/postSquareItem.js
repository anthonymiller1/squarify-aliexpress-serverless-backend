
'use strict';
const fetch = require('node-fetch')
let Item = require('./item').Item;
const jwt = require('../auth/jwtModule');
const decrypt = require('../auth/encryption').decrypt;
const uuid = require('uuid');
const FormData = require('form-data');
const real = "squareup";
const sandbox = "squareupsandbox";

let params = {
  host: `connect.${real}.com`,
  path: "/v2/catalog/batch-upsert",
  port: 443,
  method: "POST",
  headers: {
    "Square-Version": "2020-01-22",
    "Content-type": "application/json",
    "Accept": "application/json",

  }
};

const successResponse = {
  statusCode: 200,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': true,
    'Content-type': 'application/json'
  },
  body: JSON.stringify({ message: 'Item uploaded successfully' }),
};

const errorResponse = (err) => ({
  statusCode: 500,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': true,
    'Content-type': 'application/json'
  },
  body: JSON.stringify({ message: err })
});

const getImageType = (imageUrl) => imageUrl.split('.').pop();

const generateContentTypeHeader = (imageType) => {
  switch (imageType) {
    case 'jpg' || 'jpeg' || 'JPEG':
      return 'image/JPEG';
    case 'png' || 'PNG':
      return 'image/PNG';
    case 'gif' || 'GIF':
      return 'image/GIF';
    case 'pjpeg' || 'PJPEG':
      return 'image/PJPEG'
    default:
      throw Error('unknown image extension');
  }
};

exports.post = async (event, context, callback) => {

  const itemFromEventJson = JSON.parse(event['body'])['itemFromClient'];
  const itemObject = new Item(itemFromEventJson);
  const body = JSON.stringify(itemObject.toSquareItem());
  const encodedjwt = event['headers']['Authorization'];
  let decodedjwt;

  try {
    decodedjwt = jwt.verify(encodedjwt)
  } catch (e) {
    callback(null, {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
        'Content-type': 'application/json'
      },
      body: JSON.stringify(encodedjwt)
    })
  }

  const decryptedSquareOauth2Token = decrypt(decodedjwt.squareInfo.access_token);
  params.headers.Authorization = `Bearer ${decryptedSquareOauth2Token}`;

  const postItemToSquare = fetch(`https://connect.${real}.com/v2/catalog/batch-upsert`,
    {
      method: 'post',
      body: body,
      headers: params.headers
    })
    .then(res => res.json()).catch(err => callback(null, errorResponse(err)))

  const getAliImage = fetch(itemObject.image).then(res => res.buffer()).catch(err => callback(null, errorResponse(err)));

  await Promise.all([postItemToSquare, getAliImage])
    .then(
      ([squareResponse, aliImage]) => {
        // console.log('++++++++++++++++ Square Json +++++++++++++++++++++');
        // console.log(squareResponse);
        const itemId = squareResponse.objects.filter(obj => obj.type === 'ITEM')[0].id;
        const itemName = squareResponse.objects.filter(obj => obj.type === 'ITEM')[0].name;
        // console.log('++++++++++++++++ ItemId +++++++++++++++++++++');
        // console.log(itemId);
        const imageFormJson = {
          "idempotency_key": uuid(),
          "object_id": itemId,
          "image": {
            "id": "#TEMP_ID",
            "type": "IMAGE",
            "image_data": {
              "caption": itemName
            }
          }
        };

        let form = new FormData();

        form.append('request', JSON.stringify(imageFormJson),
          {
            contentType: 'application/json'
          });

        form.append('image', aliImage,
          {
            contentType: 'image/jpeg',
            filename: 'test.jpg'
          });

        fetch('https://connect.squareup.com/v2/catalog/images',
          {
            method: 'post',
            body: form,
            headers: {
              "Content-type": `multipart/form-data;boundary="${form.getBoundary()}"`,
              "Accept": "application/json",
              "Authorization": `Bearer ${decryptedSquareOauth2Token}`,
              "Square-Version": "2020-01-22",
            }
          })
          .then(
            res => res.json()
          )
          .then(
            callback(null, successResponse)
          )
          .catch(
            callback(null, errorResponse('posting image error'))
          )
      }
    ).catch(err => callback(null, errorResponse(err)));
};
