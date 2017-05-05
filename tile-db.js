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
        this.db.findOne = thenify(this.db.findOne);
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
                                            console.log(tile.hash, tile.width + "x" + tile.height);
                                        });
                                });
                        })
                }, Promise.resolve());
            })
    }

    removeTile(tileSheetName, tileIndices) {
        var self = this;
        return _.reduce(tileIndices, function(getTilePromise, tileIndex){
            return getTilePromise
                .then(function(){
                    return self.db.findOne({
                            tileIndex: Number(tileIndex),
                            tileSheetName: tileSheetName
                        })
                        .then(function(tile){
                            if (tile) {
                                return Promise.all([
                                    self.db.remove({tileIndex: tile.tileIndex}),
                                    self.db.update({
                                            tileSheetName: tile.tileSheetName,
                                            tileIndex: {
                                                $gt: tile.tileIndex
                                            }
                                        }, {
                                            $inc: {
                                                tileIndex: -1
                                            }
                                        }, {
                                            multi: true
                                        })
                                ])
                                .then(function(){
                                    console.log("Removed tile", tile.tileIndex, "from", tileSheetName);
                                })
                            } else {
                                console.log("Couldn't find a tile matching", tileIndex, "for", tileSheetName);
                            }
                        }, function(){
                            console.log("Couldn't find a tile mataching", tileIndex);
                        })
                })
        }, Promise.resolve());
    }

    write(outputPath, tileSheetName) {
        var queryObj = {};
        if (tileSheetName) {
            queryObj.tileSheetName = tileSheetName;
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
                                        name: tile.tileSheetName + '-'  + padNumber(tile.tileIndex + 1, 2),
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

    sliceTileSheet(imgs, tileSheetName, tileWidth, tileHeight, outputPath) {
        if (outputPath) {
            var rejectedPath = path.join(outputPath, 'Rejected');
        }
        if (!Array.isArray(imgs)) {
            imgs = [imgs];
        }
        var self = this;
        return self.db.find({tileSheetName: tileSheetName})
            .then(function(results){
                return Promise.all(_.map(results, Tile.deserialize))
                    .then(function(oldTiles){
                        return Tile.rejectInvalid(
                                _.flatMap(imgs, function(img){
                                    return Tile.slice(img, tileSheetName, Number(tileWidth), Number(tileHeight))
                                }),
                                oldTiles,
                                rejectedPath
                            )
                            .then(function(validTiles){
                                validTiles = _.difference(validTiles, oldTiles);

                                var skippedTiles = [];

                                return _.reduce(validTiles, function(promise, tile){
                                        return promise
                                            .then(function(confirmedTiles){
                                                return tile.confirm()
                                                    .then(function(answer){
                                                        return confirmedTiles.concat(tile);
                                                    }, function(){
                                                        console.log("Skipping tile.");
                                                        skippedTiles.push(tile);
                                                        return confirmedTiles;
                                                    });
                                            });
                                    }, Promise.resolve([]))
                                    .then(function(confirmedTiles){
                                        var tileIndex = results.length;

                                        return Promise.all(
                                            _.map(confirmedTiles, function(newTile){
                                                newTile.tileIndex = tileIndex;
                                                ++tileIndex;
                                                return newTile.serialize()
                                                    .then(function(serializedTile){
                                                        return self.db.insert(serializedTile);
                                                    });
                                            })
                                        );
                                    })
                                    .then(function(){
                                        if (rejectedPath) {
                                            var skippedDir = path.join(rejectedPath, 'Skipped');
                                            return mkdirp(skippedDir)
                                                .then(function(){
                                                    Promise.all(
                                                        _.map(skippedTiles, function(tile){
                                                            return tile.img.write(path.format({dir: skippedDir, base: 'skipped-' + tile.hash + '.png'}));
                                                        })
                                                    );
                                                });
                                        }
                                    })
                                    .then(function(){
                                        console.log("Done adding tiles to DB.");
                                        if (outputPath) {
                                            return self.write(outputPath, tileSheetName);
                                        }
                                    });
                            })
                    })
            })
    }
}

module.exports = TileDB;
