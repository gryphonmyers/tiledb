var _ = require("lodash");
var inquirer = require('inquirer');
var throwOut = require('./helpers/throw-out');
var displayImage = require('./helpers/display-image');
var Jimp = require("jimp");
var fs = require('mz/fs');
var path = require('path');
var mkdirp = require('mkdirp-then');

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

                // var newImg = new Jimp(tileWidth, tileHeight);
                // img.scan(
                //     remainingWidth - tileWidth,
                //     remainingHeight - tileHeight,
                //     tileWidth,
                //     tileHeight, function (x, y, idx) {
                //         console.log(x - remainingWidth - tileWidth, y - remainingHeight - tileHeight);
                //     // x, y is the position of this pixel on the image
                //     // idx is the position start position of this rgba tuple in the bitmap Buffer
                //     // this is the image
                //     var r   = this.bitmap.data[ idx + 0 ];
                //     var g = this.bitmap.data[ idx + 1 ];
                //     var b  = this.bitmap.data[ idx + 2 ];
                //     var a = this.bitmap.data[ idx + 3 ];
                //     newImg.setPixelColor(Jimp.rgbaToInt(r, g, b, a), x, y);
                // });
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

    static onlyValid(tiles) {
        return Tile.dedupe(Tile.filterOutEmpty(tiles));
    }

    static filterOutEmpty(tiles) {
        var emptyImg;
        var dupeThreshold = 0.13;
        console.log("Filtering out empty tiles...");
        var result = _.filter(tiles, function(tile){
            if (tile.hash == '00000000000') {
                return false;
            }

            if (!emptyImg || (emptyImg.bitmap.width != tile.width || emptyImg.bitmap.height != tile.height)) {
                emptyImg = new Jimp(tile.width, tile.height);
            }

            var distance = Jimp.distance(emptyImg, tile.img); // perceived distance
            var diff = Jimp.diff(emptyImg, tile.img);         // pixel difference

            return !(distance < dupeThreshold && diff.percent < dupeThreshold);
        });

        console.log("Filtered out", tiles.length - result.length, "empty tiles.");
        return result;

    }
    static dedupe(tiles, dupeThreshold) {
        if (_.isUndefined(dupeThreshold)) dupeThreshold = 0.11;
        console.log("Deduping tiles...");
        tiles = _.uniqBy(tiles, (tile=>tile.hash));
        var result = tiles;
        var checked = {};
        var dupeTiles = {};
        var result = [];
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
                        dupeTiles[ii] = jj;
                        (function(ii,jj){
                            var pairFolder = path.join(__dirname, 'DupePairs', tiles[jj].hash + '-' + tiles[ii].hash);
                            mkdirp(pairFolder)
                                .then(function(){
                                    tiles[ii].img.write(path.format({dir: pairFolder, base: 'rejected-' + tiles[ii].hash + '.png'}));
                                    tiles[jj].img.write(path.format({dir: pairFolder, base: tiles[jj].hash + '.png'}));
                                });
                        })(ii,jj);

                        break;
                    }
                }

            }
            if (!(ii in dupeTiles)) {
                result.push(tiles[ii]);
            }
        }

        var dupes = _.keys(dupeTiles);
        if (dupes.length) {
            console.log("Removed", dupes.length, "dupes.");
        }
        return result;
    }

    tag(tags) {
        var self = this;
        return inquirer.prompt([{
                type: 'input',
                name: 'addedTags',
                message: 'Add case-insensitive, comma-separated tags (orientation, material, theme, etc.).',
                default: tags && tags.length ? tags.join(',') : ''
            }])
            .then(function(answer){
                if (answer.addedTags) {
                    var tags = _.map(_.union(self.tags, answer.addedTags.split(',')), (string => string.toLowerCase().trim()));
                    return inquirer.prompt([{
                            type: 'confirm',
                            name: 'confirmTags',
                            message: 'New tags will be: ' + tags.join(", "),
                            default: 'y'
                        }])
                        .then(function(answer){
                            if (answer.confirmTags) {
                                self.tags = tags;
                            } else {
                                return self.tag();
                            }
                        })
                }
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
                            {name: 'Add', value: 'add', short: 'a'},
                            {name: 'Tag', value: 'tag', short: 't'}
                        ]
                    }])
                    .then(function(answer){
                        if (answer.confirmTile == 'skip') throw new Error("Aborted tile.");
                        return answer;
                    }, throwOut);
            }, throwOut);
    }

    addTags(tags) {
        this.tags = _.union(this.tags, tags);
    }
    getImg() {

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
