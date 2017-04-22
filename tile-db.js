var _ = require("lodash");
var throwOut = require('./helpers/throw-out');
// var TileSheet = require('./tile-sheet');
var Jimp = require('jimp');
var Tile = require('./tile');
var inquirer = require('inquirer');
var throwOut = require('./helpers/throw-out');
var thenify = require('thenify');
var DataStore = require('nedb');
var displayImage = require('./helpers/display-image');
var slug = require('slug')
var path = require('path');
var padNumber = require('pad-number');
var mkdirp = require('mkdirp-then');

class TileDB {
    constructor(DBPath) {
        this.db = new DataStore({ filename: DBPath });
        this.db.loadDatabase = thenify(this.db.loadDatabase);
        this.db.find = thenify(this.db.find);
        this.db.insert = thenify(this.db.insert);
        this.db.update = thenify(this.db.update);
        this.db.remove = thenify(this.db.remove);
    }

    init() {
        return this.db.loadDatabase();
    }

    list(tileSheetName) {
        return this.db.find({tileSheetName: tileSheetName})
            .then(function(results){
                return _.reduce(results, function(promise, result){
                    return promise
                        .then(function(){
                            return Tile.deserialize(result)
                                .then(function(tile){
                                    return displayImage(tile.img)
                                        .then(function(){
                                            console.log(tile.hash, tile.width + "x" + tile.height, "tags:", tile.tags);
                                        });
                                });
                        })
                }, Promise.resolve());
            })
    }

    write(outputPath, tileSheetName, tagsQuery) {
        var queryObj = {};
        if (tileSheetName) {
            queryObj.tileSheetName = tileSheetName;
        }
        if (tagsQuery) {
            queryObj.tags = JSON.parse(tagsQuery);
        }
        return this.db.find(queryObj)
            .then(function(results){
                return Promise.all(_.map(results, function(result, key){
                    return Tile.deserialize(result)
                        .then(function(tile){
                            var tileDir = path.join(outputPath, tile.tileSheetName);

                            return mkdirp(tileDir)
                                .then(function(){
                                    var tilePath = path.format({
                                        dir: tileDir,
                                        name: tile.tileSheetName + '-'  + padNumber(tile.tileIndex + 1, 2) + '-' + tile.hash,
                                        ext: '.png'
                                    });
                                    return tile.img.write(tilePath);
                                });
                        });
                }))
                .then(function(){
                    console.log("Wrote all tiles to files.");
                });
            });
    }

    sliceTileSheet(img, tileSheetName, tileWidth, tileHeight) {
        var self = this;
        return inquirer.prompt({
                type: 'input',
                message: 'Add any comma-separated tags to all tiles in this batch.',
                name: 'tags'
            })
            .then(function(answers){
                var batchTags = answers.tags ? answers.tags.split(",") : null;
                return self.db.find({tileSheetName: tileSheetName})
                    .then(function(results){
                        var newTiles = Tile.onlyValid(Tile.slice(img, tileSheetName, tileWidth, tileHeight, batchTags));

                        return Promise.all(_.map(results, Tile.deserialize))
                            .then(function(oldTiles){

                                // var allTiles = _.uniqBy(oldTiles.concat(newTiles), (tile => tile.hash));
                                var oldTags = _.intersection.apply(this, _.map(oldTiles, (oldTile=>oldTile.tags)));

                                var uniqueNewTiles = _.differenceBy(newTiles, oldTiles, (tile=>tile.hash));
                                // return _.reduce(uniqueNewTiles)
                                return _.reduce(uniqueNewTiles, function(promise, tile){
                                        return promise
                                            .then(function(confirmedTiles){
                                                // console.log('confirmedTiles', confirmedTiles);
                                                return tile.confirm()
                                                    .then(function(answer){
                                                        if (answer.confirmTile == 'tag') {
                                                            return tile.tag(_.uniq(oldTags.concat(tile.tags).concat(batchTags)))
                                                                .then(function(){
                                                                    return confirmedTiles.concat(tile);
                                                                });
                                                        } else { //assuming add
                                                            return confirmedTiles.concat(tile);
                                                        }
                                                    }, function(){
                                                        console.log("Skipping tile.");
                                                        return confirmedTiles;
                                                    });
                                            });
                                    }, Promise.resolve([]))
                                    .then(function(confirmedTiles){
                                        var tileIndex = results.length;
                                        var dupes = _.intersectionBy(oldTiles, confirmedTiles, (tile => tile.hash));
                                        var newTiles = _.differenceBy(confirmedTiles, oldTiles, (tile => tile.hash));
                                        return Promise.all(
                                            _.map(dupes, function(dupe){
                                                return self.db.update({hash: dupe.hash}, {
                                                    $set: {
                                                        tags: dupe.tags
                                                    }
                                                });
                                            }).concat(
                                                _.map(newTiles, function(newTile){
                                                    newTile.tileIndex = tileIndex;
                                                    ++tileIndex;
                                                    return newTile.serialize()
                                                        .then(function(serializedTile){
                                                            return self.db.insert(serializedTile);
                                                        });
                                                })
                                            )
                                        );
                                    })
                                    .then(function(){
                                        console.log("Added all tiles from this tilesheet!");
                                    });
                            })
                    })
            })
    }
}

module.exports = TileDB;
