var _ = require("lodash");
var inquirer = require('inquirer');
var throwOut = require('./helpers/throw-out');
var displayImage = require('./helpers/display-image');
var Jimp = require("jimp");
var fs = require('mz/fs');
var path = require('path');
var mkdirp = require('mkdirp-then');

const DEFAULT_EMPTY_THRESHOLD = 0.05;
const DEFAULT_DUPE_THRESHOLD = 0.03;

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
        var usedWidth = 0;// = img.bitmap.width;
        var usedHeight = 0;// = img.bitmap.height;
        console.log("Slicing tiles...");

        while (usedHeight < img.bitmap.height) {
            var tileHeight = Math.min(maxTileHeight, img.bitmap.height - usedHeight);

            while (usedWidth < img.bitmap.width) {
                var tileWidth = Math.min(maxTileWidth, img.bitmap.width - usedWidth);

                tiles.push(new Tile(
                    img.clone().crop(usedWidth, usedHeight, tileWidth, tileHeight),
                    tileSheetName,
                    tileWidth,
                    tileHeight,
                    tags
                ));
                usedWidth += tileWidth;
            }
            usedHeight += tileHeight;
            usedWidth = 0;
        }
        return tiles;
    }

    static rejectInvalid(tiles, referenceTiles, rejectedPath) {
        return Tile.filterOutEmpty(tiles, DEFAULT_EMPTY_THRESHOLD, rejectedPath)
            .then(function(nonEmptyTiles){
                return Tile.dedupe(nonEmptyTiles, referenceTiles, DEFAULT_DUPE_THRESHOLD, rejectedPath);
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

    checkIfDupe(refTile, dupeThreshold) {
        if (_.isUndefined(dupeThreshold)) dupeThreshold = DEFAULT_DUPE_THRESHOLD;
        var distance = Jimp.distance(refTile.img, this.img); // perceived distance
        var diff = Jimp.diff(refTile.img, this.img);         // pixel difference

        if (distance < dupeThreshold && diff.percent < dupeThreshold) {
            return true;
        }
        return false;
    }

    writeDupePair(dupe, rejectedPath) {
        var tile = this;
        var tileName = (tile.tileIndex ? tile.tileIndex : tile.hash);
        var dupeName = (dupe.tileIndex ? dupe.tileIndex : dupe.hash);

        var dupeDir = path.join(rejectedPath, 'Dupes', tile.tileSheetName, tileName + '-' + dupeName);

        return mkdirp(dupeDir)
            .then(function(){
                // console.log(arguments);
                var tilePath = path.format({dir: dupeDir, base: 'reject-' + tile.tileSheetName + '-' + tileName + '.png'});
                var dupePath = path.format({dir: dupeDir, base: 'keep-' + dupe.tileSheetName + '-' + dupeName + '.png'});
                // console.log(tilePath, dupePath);
                return Promise.all([
                    tile.img.write(tilePath),
                    dupe.img.write(dupePath)
                ]);
            })
    }

    static dedupe(inputTiles, referenceTiles, dupeThreshold, rejectedPath) {
        console.log("Deduping tiles...");
        var tiles = inputTiles;
        var checked = {};
        var dupeTiles = {};
        var result = [];
        var writePromises = [];

        var tilesToCheck = tiles.concat(referenceTiles);

        for (var ii = 0; ii < tiles.length; ++ii) {
            for (var jj = 0; jj < tilesToCheck.length; ++jj) {
                if (ii != jj && !(checked[ii] && checked[ii][jj])) {
                    if (jj < tiles.length) {
                        if (!(jj in checked)) {
                            checked[jj] = {};
                        }
                        checked[jj][ii] = 1;
                    }
                    if (tiles[ii].checkIfDupe(tilesToCheck[jj], dupeThreshold)) {
                        dupeTiles[ii] = jj;
                        if (rejectedPath) {
                            writePromises.push(tiles[ii].writeDupePair(tilesToCheck[jj], rejectedPath));
                        }
                        break;
                    }
                }
            }

            if (!(ii in dupeTiles)) {
                result.push(tiles[ii]);
            }
        }

        return Promise.all(writePromises)
            .then(function(){
                console.log("Removed", _.keys(dupeTiles).length, "dupes.");
                return result;
            });
    }

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
