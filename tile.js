var _ = require("lodash");
var inquirer = require('inquirer');
var throwOut = require('./helpers/throw-out');
var displayImage = require('./helpers/display-image');
var Jimp = require("jimp");
var fs = require('mz/fs');
var path = require('path');
var mkdirp = require('mkdirp-then');

const DEFAULT_EMPTY_THRESHOLD = 0.13;
const DEFAULT_DUPE_THRESHOLD = 0.12;

function decodeBase64Image(dataString) {
    var matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/),
    response = {};

    if (matches.length !== 3) {
    return new Error('Invalid input string');
    }

    response.type = matches[1];
    response.data = Buffer.from(matches[2], 'base64');

    return response;
}


class Tile {

    constructor(img, tileSheetName, width, height, tags, tileIndex) {
        this.tileSheetName = tileSheetName;
        this.width = width;
        this.height = height;
        this.img = img;
        this.hash = this.img.hash();
        this.tags = tags || [];
        this.tileIndex = isNaN(tileIndex) ? null : tileIndex;
    }

    static slice(img, tileSheetName, maxTileWidth, maxTileHeight, tags) {
        var tiles = [];
        var remainingWidth = img.bitmap.width;
        var remainingHeight = img.bitmap.height;
        console.log("Slicing tiles...");

        while (remainingWidth > 0) {
            var tileWidth = Math.min(maxTileWidth, remainingWidth);
            while (remainingHeight > 0) {
                var tileHeight = Math.min(maxTileHeight, remainingHeight);

                tiles.push(new Tile(
                    img.clone().crop(remainingWidth - tileWidth, remainingHeight - tileHeight, tileWidth, tileHeight),
                    tileSheetName,
                    tileWidth,
                    tileHeight,
                    tags
                ));
                remainingHeight -= tileHeight;
            }
            remainingWidth -= tileWidth;
            remainingHeight = img.bitmap.height;
        }
        return tiles;
    }

    static rejectInvalid(tiles, rejectedPath) {
        return Tile.filterOutEmpty(tiles, DEFAULT_EMPTY_THRESHOLD, rejectedPath)
            .then(function(nonEmptyTiles){
                return Tile.dedupe(nonEmptyTiles, DEFAULT_DUPE_THRESHOLD, rejectedPath);
            });
    }

    static filterOutEmpty(tiles, dupeThreshold, rejectedPath) {
        var emptyImg;
        if (_.isUndefined(dupeThreshold)) dupeThreshold = DEFAULT_EMPTY_THRESHOLD;

        console.log("Filtering out empty tiles...");
        var promise = Promise.resolve();
        
        if (rejectedPath) {
            promise = promise
                .then(function(){
                    var emptyDir = path.join(rejectedPath, 'Empty');
                    return mkdirp(emptyDir)
                        .then(function(){
                            return emptyDir;
                        });
                })
        }
        var writePromises = [];
        var result = _.filter(tiles, function(tile){
            if (tile.hash == '00000000000') {
                var isDupe = true;
            } else {
                if (!emptyImg || (emptyImg.bitmap.width != tile.width || emptyImg.bitmap.height != tile.height)) {
                    emptyImg = new Jimp(tile.width, tile.height);
                }

                var distance = Jimp.distance(emptyImg, tile.img); // perceived distance
                var diff = Jimp.diff(emptyImg, tile.img);         // pixel difference

                isDupe = distance < dupeThreshold && diff.percent < dupeThreshold;
            }

            if (rejectedPath && isDupe) {
                writePromises.push(
                    promise
                        .then(function(emptyDir){
                            return tile.img.write(path.format({dir: emptyDir, base: 'empty-' + tile.hash + '.png'}));
                        })
                );
            }

            return !isDupe;
        });

        return promise
            .then(function(){
                return Promise.all(writePromises);
            })
            .then(function(){
                console.log("Filtered out", tiles.length - result.length, "empty tiles.");
                return result;
            });
    }

    static dedupe(inputTiles, dupeThreshold, rejectedPath) {
        if (_.isUndefined(dupeThreshold)) dupeThreshold = DEFAULT_DUPE_THRESHOLD;
        console.log("Deduping tiles...");

        var tiles = _.uniqBy(inputTiles, (tile=>tile.hash));
        var checked = {};
        var dupeTiles = {};
        var result = [];
        var promise = Promise.resolve();
        if (rejectedPath) {
            promise = promise
                .then(function(){
                    var emptyDir = path.join(rejectedPath, 'Dupes');
                    return mkdirp(emptyDir)
                        .then(function(){
                            return emptyDir;
                        });
                });
        }
        var writePromises = [];
        for (var ii = 0; ii < tiles.length; ++ii) {
            for (var jj = 0; jj < tiles.length; ++jj) {
                if (ii != jj && !(checked[ii] && checked[ii][jj])) {
                    var distance = Jimp.distance(tiles[jj].img, tiles[ii].img); // perceived distance
                    var diff = Jimp.diff(tiles[jj].img, tiles[ii].img);         // pixel difference

                    if (!(jj in checked)) {
                        checked[jj] = {};
                    }
                    checked[jj][ii] = 1;

                    if (distance < dupeThreshold && diff.percent < dupeThreshold) {
                        if (rejectedPath) {
                            (function(ii,jj){
                                writePromises.push(
                                    promise
                                        .then(function(dupeDir){
                                            return tiles[ii].img.write(path.format({dir: dupeDir, base: tiles[ii].hash + '-dupe-of-' + tiles[jj].hash + '.png'}));
                                        })
                                )
                            })(ii,jj);
                        }
                        dupeTiles[ii] = jj;
                        break;
                    }
                }

            }
            if (!(ii in dupeTiles)) {
                result.push(tiles[ii]);
            }
        }

        return promise
            .then(function(){
                return Promise.all(writePromises);
            })
            .then(function(){
                console.log("Removed", inputTiles.length - result.length, "dupes.");
                return result;
            });
    }

    // tag(tags) {
    //     var self = this;
    //     return inquirer.prompt([{
    //             type: 'input',
    //             name: 'addedTags',
    //             message: 'Add case-insensitive, comma-separated tags (orientation, material, theme, etc.).',
    //             default: tags && tags.length ? tags.join(',') : ''
    //         }])
    //         .then(function(answer){
    //             if (answer.addedTags) {
    //                 var tags = _.map(_.union(self.tags, answer.addedTags.split(',')), (string => string.toLowerCase().trim()));
    //                 return inquirer.prompt([{
    //                         type: 'confirm',
    //                         name: 'confirmTags',
    //                         message: 'New tags will be: ' + tags.join(", "),
    //                         default: 'y'
    //                     }])
    //                     .then(function(answer){
    //                         if (answer.confirmTags) {
    //                             self.tags = tags;
    //                         } else {
    //                             return self.tag();
    //                         }
    //                     })
    //             }
    //         });
    // }

    confirm() {
        var self = this;
        return displayImage(self.img)
            .then(function(){
                return inquirer.prompt([{
                        type: 'list',
                        name: 'confirmTile',
                        message: self.hash + ' - ' + self.width + 'x' + self.height + ' tile (preview). Look ok?',
                        default: 1,
                        choices: [
                            {name: 'Skip', value: 'skip', short: 's'},
                            {name: 'Add', value: 'add', short: 'a'}
                            // {name: 'Tag', value: 'tag', short: 't'}
                        ]
                    }])
                    .then(function(answer){
                        if (answer.confirmTile == 'skip') throw new Error("Aborted tile.");
                        return answer;
                    }, throwOut);
            }, throwOut);
    }

    static deserialize(obj) {
        return Jimp.read(decodeBase64Image(obj.base64).data)
            .then(function(image){
                return new Tile(image, obj.tileSheetName, obj.width, obj.height, obj.tags, obj.tileIndex);
            }, throwOut);
    }

    serialize() {
        var self = this;
        return new Promise(function(resolve, reject){
            self.img.getBase64(Jimp.MIME_PNG, function(err, base64){
                if (err) reject(err);
                var serialized = _.toPlainObject(self);
                delete serialized.img;
                serialized.base64 = base64;
                resolve(serialized);
            });
        })
    }

}
module.exports = Tile;
