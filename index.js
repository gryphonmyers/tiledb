#!/usr/bin/env node

var _ = require("lodash");
var yargs = require('yargs');
var TileDB = require('./tile-db');
var Jimp = require('jimp');
var throwOut = require('./helpers/throw-out');
var fs = require('mz/fs');
var path = require('path');

const CONFIG_PATH = './config.json';



function writeConfig(config) {
    return fs.writeFile(CONFIG_PATH, JSON.stringify(config))
        .then(function(){
            return config;
        });
}

function openConfig() {
    return fs.readFile(CONFIG_PATH)
        .then(function(data){
            return JSON.parse(data);
        },function(){
            config = {DBPath : './', DBFileName: 'tiledb', outputPath: __dirname};
            return writeConfig(config);
        })
}

openConfig()
    .then(function(config){
        var tileDB = new TileDB(path.format({dir: config.DBPath, base: config.DBFileName}));

        yargs
            .command({
                command: 'slice <src> <name> <tileWidth> <tileHeight>',
                description: 'Add a tileset image to the db',
                handler: function(args){
                    tileDB.init()
                        .then(function(){
                            return Jimp.read(args.src)
                                .then(function(imgObj) {
                                    return tileDB.sliceTileSheet(imgObj, args.name, args.tileWidth, args.tileHeight);
                                });
                        }, throwOut)
                }
            })
            .command({
                command: 'list <tileSheetName>',
                description: 'Lists existing tiles in the db',
                handler: function(args){
                    tileDB.init()
                        .then(function(){
                            return tileDB.list(args.tileSheetName);
                        }, throwOut)

                }
            })
            .command({
                command: 'write [outputPath] [tileSheetName] [tagsQuery]',
                description: 'Writes tiles in db to files',
                handler: function(args){
                    tileDB.init()
                        .then(function(){
                            return tileDB.write(args.outputPath || config.outputPath, args.tileSheetName, args.tagsQuery);
                        }, throwOut)

                }
            })
            .command({
                command: 'config',
                description: 'Sets persistent config options.',
                handler: function(args){
                    var promise = Promise.resolve();
                    if (args.DBPath) {
                        promise = promise
                            .then(function(){
                                var oldPath = path.format({dir: config.DBPath, base: config.DBFileName});
                                var newPath = path.format({dir: args.DBPath, base: config.DBFileName});
                                console.log("Moving DB from", oldPath, "to", newPath);
                                return fs.rename(oldPath, newPath)
                                    .then(function(){
                                        config.DBPath = args.DBPath;
                                        return writeConfig(config)
                                            .then(function(){
                                                console.log("Set DB path to", config.DBPath);
                                            });
                                    }, function(err) {
                                        if (err.code === 'ENOENT') {
                                            config.DBPath = args.DBPath;
                                            return writeConfig(config)
                                                .then(function(){
                                                    console.log("Set DB path to", config.DBPath);
                                                });
                                        } else {
                                            throw 'Failed renaming DB';
                                        }
                                    });
                            });
                    }

                    if (args.outputPath) {
                        promise = promise
                            .then(function(){
                                config.outputPath = args.outputPath;
                                return writeConfig(config)
                                    .then(function(){
                                        console.log("Set default output path to", config.outputPath);
                                    });
                            });
                    }
                },
                builder: {
                    'DBPath': {
                        alias: 'd'
                    },
                    'outputPath': {
                        alias: 'o'
                    }
                }
            })
            .demandCommand(1)
            .argv;


    })
