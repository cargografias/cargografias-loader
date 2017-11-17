var Q = require('q');
var PopitToolkit = require('popit-toolkit');
var fs = require("fs");
var request = require('request');
var beautify = require('js-beautify').js_beautify;
var crypto = require('crypto');

var config = null;
var content; // = require("./cargos.json"); //Google spreadsheet exported as JSON
var toolkit;

function downloadSpreadsheet() {

  var deferred = Q.defer();

  request(config.gsheetsUrl, function(error, response, body) {
    if (!error && response.statusCode == 200) {
      fs.writeFileSync('data/cargos.json', beautify(body, {
        indent_size: 2
      }));
      deferred.resolve();
    } else {
      deferred.reject("Error getting file")
    }
  })

  return deferred.promise;
}

function loadSpreadsheetData() {
  var deferred = Q.defer();
  content = require('./data/cargos.json')
  deferred.resolve();
  return deferred.promise;
}

function popitCreateOrganizations() {
  var deferred = Q.defer();
  var organizations = {};
  var itemsToPost = [];
  content.feed.entry.forEach(function(item) {
    var key = item.gsx$organizacion.$t
    if (!organizations[key]) {
      organizations[key] = 1;
      itemsToPost.push({
        name: key
      });
    }
  });
  toolkit.postItems('organizations', itemsToPost).then(
    function() {
      console.log('done');
      deferred.resolve();
    },
    function(err) {
      console.log('err', err);
      deferred.reject(err)
    },
    function(progress) {
      console.log(progress);
    }
  )
  return deferred.promise;
}

/**
 * Returns a random integer between min (inclusive) and max (inclusive)
 * Using Math.round() will give you a non-uniform distribution!
 */
function getRandomIdInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function popitCreatePersons() {
  var deferred = Q.defer();
  var personas = {};
  var personasArr = [];
  content.feed.entry.forEach(function(item, ix) {
    try {
      var key = item.gsx$nombre.$t + ' ' + item.gsx$apellido.$t;
      if (!personas[key]) {
        personas[key] = 1; //de-duplicate
        var persona = {
          name: item.gsx$nombre.$t + ' ' + item.gsx$apellido.$t,
          family_name: item.gsx$apellido.$t,
          given_name: item.gsx$nombre.$t,
          image: item.gsx$urlfoto.$t,
          gender: item.gsx$sexo.$t,
        };
        if (item.gsx$nrodedoc.$t) {
          persona.identifiers = [{
            identifier: item.gsx$nrodedoc.$t,
            scheme: item.gsx$documentotipo.$t
          }]
        }
        personasArr.push(persona);
      }
    } catch (ex) {
      console.log("Error importing Person")
      console.log(ex.stack);
    }
  });
  toolkit.postItems('persons', personasArr).then(
    function() {
      console.log("done");
      deferred.resolve();
    },
    function(err) {
      console.log('err', err);
      deferred.reject(err);
    },
    function(p) {
      console.log(p)
    }
  );
  return deferred.promise;
}

function popitCreateMemberships() {
  var allOrganizations = require("./data/organizations.json");
  var allPersons = require("./data/persons.json");
  var deferred = Q.defer();
  var dateRe = /^[0-9]{4}(-[0-9]{2}){0,2}$/;
  var organizations = allOrganizations.reduce(function(memo, organization) {
    memo[organization.name] = organization;
    return memo;
  }, {});
  var persons = allPersons.reduce(function(memo, person) {
    memo[person.name] = person;
    return memo;
  }, {});
  var membershipsToPost = [];
  var invalids = 0;
  content.feed.entry.forEach(function(item) {
    var membership = {
      "label": item.gsx$cargonominal.$t,
      "role": item.gsx$cargonominal.$t,
      "type": item.gsx$cargotipo.$t,
      "class": item.gsx$cargoclase.$t,
      "intended_duration": item.gsx$duracioncargo.$t,
      "person_id": persons[item.gsx$nombre.$t + " " + item.gsx$apellido.$t].id,
      "organization_id": organizations[item.gsx$organizacion.$t].id,
      "naming_date": item.gsx$fechanombramiento.$t,
      "area_id": item.gsx$areaid.$t,
      "party": item.gsx$partido.$t,
      "party_id": item.gsx$partidogeneral.$t,
      "heritage": item.gsx$patrimtotal.$t,
      "heritage_url": item.gsx$patrimurl.$t,
      "notes": item.gsx$observaciones.$t,
      "added_by": item.gsx$agregadopor.$t,
    };
    var startDate = transformDateStr(item.gsx$fechainicio.$t); // || item.gsx$fechainicioyear.$t;
    if (startDate) {
      membership.start_date = startDate;
    }
    var endDate = transformDateStr(item.gsx$fechafin.$t); // || item.gsx$fechafinyear.$t;
    if (endDate) {
      membership.end_date = endDate;
    }
    if (!startDate) {
      if (item.gsx$fechainicioyear.$t) {
        membership.start_date = item.gsx$fechainicioyear.$t + "-12-10";
        membership.start_date_accuracy = "year";
      }
    }
    if (!endDate) {
      if (item.gsx$fechafinyear.$t) {
        membership.end_date = item.gsx$fechafinyear.$t + '-12-10';
        membership.end_date_accuracy = "year";
      }
    }
    //Validate dates
    if (startDate && !dateRe.test(startDate)) {
      console.log('invalid start ', startDate);
    }
    if (endDate && !dateRe.test(endDate)) {
      console.log('invalid end ', endDate);
    }
    //Sources
    if (item.gsx$fuentededatosinicio.$t || item.gsx$urlfuenteinicio.$t) {
      membership.sources = membership.sources || [];
      membership.sources.push({
        data: "start_date",
        source: item.gsx$fuentededatosinicio.$t,
        source_url: item.gsx$urlfuenteinicio.$t,
        quality: item.gsx$calidaddeldatoinicio.$t,
      });
    }
    if (item.gsx$fuentededatosfin.$t || item.gsx$urlfuentefin.$t) {
      membership.sources = membership.sources || [];
      membership.sources.push({
        data: "end_date",
        source: item.gsx$fuentededatosfin.$t,
        source_url: item.gsx$urlfuentefin.$t,
        quality: item.gsx$calidaddeldatofin.$t,
      });
    }
    if (item.gsx$territorio.$t) {
      membership.area = {
        id: item.gsx$territorio.$t + ', ' + item.gsx$territorioextendido.$t,
        name: item.gsx$territorio.$t + ', ' + item.gsx$territorioextendido.$t
      };
    }
    membershipsToPost.push(membership);
  });
  var totalItems = membershipsToPost.length;
  return deferred.promise;
}

function transformDateStr(input) {
  var p = input.split('/');
  var res = [];
  if (p.length == 3) {
    res.push(p[2]);
    res.push('-');
    if (p[1].length == 1) {
      res.push('0');
    }
    res.push(p[1]);
    res.push('-');
    if (p[0].length == 1) {
      res.push('0');
    }
    res.push(p[0]);
    return res.join('');
  }
}

function popitLoadPersons() {

  return Q.Promise(function(resolve, reject, notify) {
    toolkit.loadAllItems('persons').then(function(personas) {
      var p = JSON.stringify(personas);
      fs.writeFileSync('data/persons.json', beautify(p, {
        indent_size: 2
      }));
      console.log('total personas', personas.length)
      resolve();
    }, function(err) {
      console.log('error', err);
      reject();
    }, function(progress) {
      console.log(progress);
      notify(progress);
    });
  });

}

function popitLoadOrganizations() {
  return Q.Promise(function(resolve, reject, notify) {
    toolkit.loadAllItems('organizations').then(function(organizations) {
      var p = JSON.stringify(organizations);
      fs.writeFileSync('data/organizations.json', beautify(p, {
        indent_size: 2
      }));
      console.log('total organizations', organizations.length)
      resolve();
    }, reject, function(p) {
      console.log(p)
      notify(p);
    });
  })
}

function showCargosExtendidos() {
  var cargosExt = {};
  content.feed.entry.forEach(function(item) {
    cargosExt[item.gsx$cargoext.$t] = (cargosExt[item.gsx$cargoext.$t] || 0) + 1;
  });

  console.log(cargosExt);
}

function popitLoadMemberships() {

  return Q.Promise(function(resolve, reject, notify) {

    toolkit.loadAllItems('memberships').then(function(posts) {
      var p = JSON.stringify(posts);
      fs.writeFileSync('data/memberships.json', beautify(p, {
        indent_size: 2
      }));
      console.log('Total Memberships', posts.length)
      resolve();
    }, function(err) {
      console.log('error', err);
      reject(err);
    }, function(progress) {
      console.log(progress);
      notify(progress);
    });

  });
}

function popitDeletePersons() {
  var mem = require('./data/persons.json').map(function(it) {
    return it.id;
  });
  var pending = mem.length;
  return toolkit.deleteItems('persons', mem).then(
    function() {
      console.log('done')
    },
    function(err) {
      console.log('err', err)
    },
    function(progress) {
      pending -= 1;
      console.log('pending ', pending);
    }
  );
}

function popitDeleteOrganizations() {
  var mem = require('./data/organizations.json').map(function(it) {
    return it.id;
  });
  var pending = mem.length;
  console.log("Deleting organizations: " + pending);
  return toolkit.deleteItems('organizations', mem).then(
    function() {
      console.log('done')
    },
    function(err) {
      console.log('err', err)
    },
    function(progress) {
      pending -= 1;
      console.log('pending ', pending);
    }
  );
}

function popitDeleteMemberships() {
  console.log("Deleting Memberships")
  var mem = require('./data/memberships.json').map(function(it) {
    return it.id;
  });
  var pending = mem.length;
  return toolkit.deleteItems('memberships', mem).then(
    function() {
      console.log('done')
    },
    function(err) {
      console.log('err', err)
    },
    function(progress) {
      pending -= 1;
      console.log('pending ', pending);
    }
  );
}

function cloudPost(public_id, photoUrl) {

  return Q.Promise(function(resolve, reject, notify) {

    var unixTimeInSeconds = Math.floor(Date.now() / 1000);
    var apikey = config.cloudinary_apikey
    var secret = config.cloudinary_secret

    // These are the values tha need to be signed:
    // callback, eager, format, public_id, tags, timestamp, transformation, type
    // Anything else should be added later, after calculating the signature.
    // http://cloudinary.com/documentation/upload_images#request_authentication

    var params = {
      timestamp: unixTimeInSeconds,
      format: "jpg",
      transformation: "w_200,h_200,c_thumb,g_face",
      public_id: public_id
    }

    var signItems = []
    Object.keys(params).sort().forEach(function(key) {
      signItems.push(key + '=' + params[key])
    })
    var signString = signItems.join('&') + secret;
    var signature = crypto.createHash('sha1').update(signString).digest('hex')

    //not signing params:
    params.file = photoUrl;
    params.signature = signature;
    params.api_key = apikey;

    var reqOpts = {
      method: "POST",
      url: config.cloudinary_uploadurl,
      json: true,
      body: params
    };

    request(reqOpts, function(err, response, body) {
      if (err) {
        reject({
          err: err,
          response: response,
          body: body
        })
      } else {
        if (body.error) {
          reject({
            err: body.error,
            body: body
          })
        } else {
          resolve(body)
        }
      }
    })

  });

}

function updatePerson(person) {

  return Q.promise(function(resolve, reject, notify) {

    var url = "https://" + config.host + "/api/v0.1/persons/" + person.id;

    var options = {
      url: url,
      method: 'PUT',
      body: person,
      json: true,
      headers: {
        'Authorization: Token': config.Apikey
      }
    }

    request(options, function(err, httpResponse, body) {
      if (err) {
        console.log(err)
        reject(err);
      } else {
        resolve(body);
      }
    })

  });
}

function createCloudinaryImageForPerson(person) {
  return Q.Promise(function(resolve, reject, notify) {
    var public_id = config.host.match(/^(.*?)\./)[1] + "/" + person.id;
    cloudPost(public_id, person.image)
      .then(function(result) {
        person.image_original = person.image;
        person.image = result.secure_url;
        delete person.images;
        updatePerson(person)
          .then(function(result) {
            console.log('completed', person.name)
            resolve(result)
          })
          .catch(function(err) {
            console.log("error updating person", person, err)
            reject({
              message: "error updating person",
              person: person,
              err: err
            });
          })
      })
      .catch(function(err) {
        console.log("error creating cloudinary", person, err)
        reject({
          message: "error creating cloudinary",
          person: person,
          err: err
        });
      });
  });
}

function popitUpdateCloudinary() {
  var cloudRE = /^(?:http\:|https\:|)\/\/res\.cloudinary\.com/
  return Q.Promise(function(resolve, reject, notify) {
    var persons = require('./data/persons.json');
    var promises = [];
    persons.forEach(function(person) {
      if (person.image && !cloudRE.test(person.image)) {
        promises.push(createCloudinaryImageForPerson(person));
      }
    })
    console.log("Total Persons:", persons.length)
    console.log('   To Process:', promises.length);
    var completed = 0;
    var errored = 0;
    Q.allSettled(promises)
      .then(function(results) {
        results.forEach(function(result) {
          if (result.state === "fulfilled") {
            completed++;
            //var value = result.value;
          } else {
            errored++;
            var reason = result.reason;
          }
        });
        console.log("  Completed:", completed);
        console.log("  Errored:", errored);
        resolve();
      });
  });
}

function runProgram(argv) {
  if (argv.length != 4) {
    console.log("Usage: node process.js [import|delete|updatephotos] [instanceName]")
  } else {
    var action = argv[2];
    var instance = argv[3];
    config = require("./config/" + "development" + ".json");
    console.log("Instance: " + config.host);
    toolkit = PopitToolkit({
      host: config.host,
      Apikey: config.Apikey
    });
    if (["import", "delete", "updatephotos", "json", "sinar"].indexOf(action) == -1) {
      console.log("Invalid action " + action);
      return;
    }
    if ("import" == action) {
      runImport();
    } else if ("delete" == action) {
      runDelete();
    } else if ("updatephotos" == action) {
      runUpdatePhotos();
    } else if ("json" == action) {
      runCreateJSONs();
    } else if ("sinar" == action) {
      runSINAR();
    }
  }
}

//POPIT LOADER FUNCTIONS

function runImport() {
  Q.fcall(function() {})
    .then(downloadSpreadsheet)
    .then(loadSpreadsheetData)
    .then(popitCreatePersons)
    .then(popitLoadPersons)
    .then(popitCreateOrganizations)
    .then(popitLoadOrganizations)
    .then(popitCreateMemberships)
    .then(popitLoadMemberships)
    .catch(function(err) {
      console.log("Something went wrong");
      console.log(err);
      throw err;
    })
    .done();
}

function runDelete() {
  Q.fcall(function() {})
    .then(popitLoadMemberships)
    .then(popitDeleteMemberships)
    .then(popitLoadOrganizations)
    .then(popitDeleteOrganizations)
    .then(popitLoadPersons)
    .then(popitDeletePersons)
    .catch(function(err) {
      console.log("Something went wrong");
      throw err;
    })
    .done();
}

function runUpdatePhotos() {
  Q.fcall(function() {})
    .then(popitLoadPersons)
    .then(popitUpdateCloudinary)
    .catch(function(err) {
      console.log("Something went wrong");
      throw err;
    })
    .done();
}

//SINAR LOADER FUNCTIONS
function runSINAR() {
  Q.fcall(function() {})
    //.then(downloadSpreadsheet)
    //.then(loadSpreadsheetData)
    //.then(sinarCreatePersons)
    //.then(sinarLoadPersons)
    //.then(sinarCreateOrganizations)
    //.then(sinarLoadOrganizations)
    //.then(sinarCreateMemberships)
    //.then(sinarCheckPeopleOutside)
    //.then(sinarLoadMemberships)
    .then(sinarCreatePeopleWithMembershipsJSON)
    .catch(function(err) {
      console.log("Something went wrong");
      console.log(err);
      throw err;
    })
    .done();
}

function sinarLoadPersonsFirstPage(num_pages,currentJSON){
  return Q.promise(function(resolve, reject, notify) {
    console.log("Starting loading from SINAR project");
    var options = {
      url: "",
      method: 'GET',
      //json: true,
      headers: {
        'Authorization': config.SinarApikey
      }
    }
    var pageNumber = 1;
    options.url = config.SinarURL + "persons?page="+pageNumber;
    console.log("SINAR URL is " + options.url);
    request(options, function(err, httpResponse, body) {
      console.log("Se envio request");
      if (err) {
        console.log(err)
        reject(err);
      } else {

        var jsonBody = JSON.parse(body);
        //console.log(jsonBody.num_pages);
        num_pages = jsonBody.num_pages;
        currentJSON = jsonBody.results;
        //console.log(currentJSON);
        var result = {
          "num_pages": num_pages,
          "json": currentJSON
        };
        //console.log("FINISHED FIRST PROMISE");
        resolve(result);
      }
    });
  });
}

function sinarLoadPersonsByPage(pageNumber,num_pages,sinarPersonsArray){
  var totArray = sinarPersonsArray.slice();
  return Q.promise(function(resolve, reject, notify) {
    //console.log("Starting loading from SINAR project");
    var options = {
      url: config.SinarURL + "persons?page="+pageNumber,
      method: 'GET',
      //json: true,
      headers: {
        'Authorization': config.SinarApikey
      }
    }
    console.log("SINAR URL is " + options.url);
    request(options, function(err, httpResponse, body) {
      //console.log("Se envio request");
      if (err) {
        console.log(err)
        reject(err);
      } else {
        var jsonBody = JSON.parse(body);
        //console.log(jsonBody.num_pages);
        page = jsonBody.page;
        currentJSON = jsonBody.results;
        var result = {
          "page": page,
          "json": currentJSON
        };
        /*for(var _obj in currentJSON){
          sinarPersonsArray.concat(currentJSON[_obj])
        };*/
        //console.log(totArray);
        totArray = totArray.concat(currentJSON);
        if(page<num_pages){
          var nextPage = page + 1;
          sinarLoadPersonsByPage(nextPage,num_pages,totArray).then(
            function(data){
              //console.log("Finished page: " + data.page);
              resolve(data);
            }
          );
        }else{
          var p = JSON.stringify(totArray);
          fs.writeFileSync('data/persons-sinar.json', beautify(p, {
            indent_size: 2
          }));
          console.log("LOADED PERSONS WITH IDs FROM SINAR: " + totArray.length);
          resolve(result);
        }
      }
    });
  });
}

function sinarLoadPersons(){
  return Q.promise(function(resolve, reject, notify) {
    var num_pages;
    var finalJSON = [{}];
    sinarLoadPersonsFirstPage(num_pages,finalJSON).then(
      function(data){
        //console.log(data);
        num_pages = data.num_pages;
        //for(var _obj in currentJSON) sinarPersonsArray.concat(currentJSON[_obj]);
        var sinarPersonsArray = data.json;
        if(num_pages>1){
          var i = 2;
          sinarLoadPersonsByPage(i,num_pages,sinarPersonsArray).then(
            function(data){
              //console.log(sinarPersonsArray);
              /*var p = JSON.stringify(sinarPersonsArray);
              fs.writeFileSync('data/persons-sinar.json', beautify(p, {
                indent_size: 2
              }));*/
              resolve(data);
            }
          );
        }

      }
    );
  });
}

function sinarCreatePersons() {
  var deferred = Q.defer();
  var personas = {};
  var personasArr = [];
  content.feed.entry.forEach(function(item, ix) {
    try {
      var key = item.gsx$nombre.$t + ' ' + item.gsx$apellido.$t;
      if (!personas[key]) {
        personas[key] = 1; //de-duplicate
        var persona = {
          name: item.gsx$nombre.$t + ' ' + item.gsx$apellido.$t,
          family_name: item.gsx$apellido.$t,
          given_name: item.gsx$nombre.$t,
          image: item.gsx$urlfoto.$t,
          gender: item.gsx$sexo.$t,
          //id: getRandomIdInt(100000000000,999999000000) + ix
        };
        if (item.gsx$nrodedoc.$t) {
          persona.identifiers = [{
            identifier: item.gsx$nrodedoc.$t,
            scheme: item.gsx$documentotipo.$t
          }]
        }
        personasArr.push(persona);
        sendPersonToSINAR(persona);
      }
    } catch (ex) {
      console.log("Error importing Person")
      console.log(ex.stack);
    }
  });
  deferred.resolve();
  return deferred.promise;
}

function sendPersonToSINAR(person){
  return Q.promise(function(resolve, reject, notify) {
    var url = config.SinarURL + "persons";
    var options = {
      url: url,
      method: 'POST',
      body: person,
      json: true,
      headers: {
        'Authorization': config.SinarApikey
      }
    }
    request(options, function(err, httpResponse, body) {
      if (err) {
        console.log(err)
        reject(err);
      } else {
        console.log(body);
        resolve(body);
      }
    });
  });
}

function sinarCreateOrganizations() {
  var deferred = Q.defer();
  var organizations = {};
  var itemsToPost = [];
  content.feed.entry.forEach(function(item) {
    var key = item.gsx$organizacion.$t
    if (!organizations[key]) {
      organizations[key] = 1;
      var org = {
        name: key
      };
      itemsToPost.push(org);
      sendOrganizationToSINAR(org);
    }
  });
  deferred.resolve();
  return deferred.promise;
}

function sendOrganizationToSINAR(org){
  return Q.promise(function(resolve, reject, notify) {
    var url = config.SinarURL + "organizations";
    var options = {
      url: url,
      method: 'POST',
      body: org,
      json: true,
      headers: {
        'Authorization': config.SinarApikey
      }
    }
    console.log("sending organization: "+ org);
    request(options, function(err, httpResponse, body) {
      if (err) {
        console.log(err)
        reject(err);
      } else {
        console.log(body);
        resolve(body);
      }
    });
  });
}

function sinarLoadOrganizationsFirstPage(num_pages,currentJSON){
  return Q.promise(function(resolve, reject, notify) {
    console.log("Starting loading from SINAR project");
    var options = {
      url: "",
      method: 'GET',
      //json: true,
      headers: {
        'Authorization': config.SinarApikey
      }
    }
    var pageNumber = 1;
    options.url = config.SinarURL + "organizations?page="+pageNumber;
    console.log("SINAR URL is " + options.url);
    request(options, function(err, httpResponse, body) {
      console.log("Se envio request");
      if (err) {
        console.log(err)
        reject(err);
      } else {
        var jsonBody = JSON.parse(body);
        //console.log(jsonBody.num_pages);
        num_pages = jsonBody.num_pages;
        currentJSON = jsonBody.results;
        var result = {
          "num_pages": num_pages,
          "json": currentJSON
        };
        //console.log("FINISHED FIRST PROMISE");
        resolve(result);
      }
    });
  });
}

function sinarLoadOrganizationsByPage(pageNumber,num_pages,sinarOrganizationsArray){
  var totArray = sinarOrganizationsArray.slice();
  return Q.promise(function(resolve, reject, notify) {
    console.log("Starting loading from SINAR project");
    var options = {
      url: config.SinarURL + "organizations?page="+pageNumber,
      method: 'GET',
      //json: true,
      headers: {
        'Authorization': config.SinarApikey
      }
    }
    //console.log("SINAR URL is " + options.url);
    request(options, function(err, httpResponse, body) {
      //console.log("Se envio request");
      if (err) {
        console.log(err)
        reject(err);
      } else {
        var jsonBody = JSON.parse(body);
        //console.log(jsonBody.num_pages);
        page = jsonBody.page;
        currentJSON = jsonBody.results;
        var result = {
          "page": page,
          "json": currentJSON
        };
        //for(var _obj in currentJSON) sinarOrganizationsArray.concat(currentJSON[_obj]);
        totArray = totArray.concat(currentJSON);
        if(page<num_pages){
          var nextPage = page + 1;
          sinarLoadOrganizationsByPage(nextPage,num_pages,totArray).then(
            function(data){
              //console.log("Finished page: " + data.page);
              resolve(data);
            }
          );
        }else{
          console.log("LOADED ORGANIZATIONS WITH IDs FROM SINAR: " + totArray.length);
          //console.log(sinarOrganizationsArray);
          var p = JSON.stringify(totArray);
          fs.writeFileSync('data/organizations-sinar.json', beautify(p, {
            indent_size: 2
          }));
          resolve(result);
        }
      }
    });
  });
}

function sinarLoadOrganizations(){
  return Q.promise(function(resolve, reject, notify) {
    var num_pages;
    var finalJSON = [{}];
    sinarLoadOrganizationsFirstPage(num_pages,finalJSON).then(
      function(data){
        //console.log(data);
        num_pages = data.num_pages;
        //console.log(data.json);
        //for(var _obj in currentJSON) sinarOrganizationsArray.concat(currentJSON[_obj]);
        var sinarOrganizationsArray = data.json;
        if(num_pages>1){
          var i = 2;
          sinarLoadOrganizationsByPage(i,num_pages,sinarOrganizationsArray).then(
            function(data){
              resolve(data);
            }
          );
        }

      }
    );
  });
}

function sinarCreateMemberships() {
  var allOrganizations = require("./data/organizations-sinar.json");
  var allPersons = require("./data/persons-sinar.json");
  var deferred = Q.defer();
  var dateRe = /^[0-9]{4}(-[0-9]{2}){0,2}$/;
  var organizations = allOrganizations.reduce(function(memo, organization) {
    memo[organization.name] = organization;
    return memo;
  }, {});
  //console.log(allPersons);
  var persons = allPersons.reduce(function(memo, person) {
    //console.log(person);
    //console.log(memo);
    memo[person.name] = person;
    return memo;
  }, [{}]);
  //console.log(persons);
  var membershipsToPost = [];
  var invalids = 0;
  content.feed.entry.forEach(function(item) {
    //var idvalue = getRandomIdInt(100000000000,999999000000);
    //console.log(persons[item.gsx$nombre.$t + " " + item.gsx$apellido.$t]);
    //console.log(item.gsx$nombre.$t + " " + item.gsx$apellido.$t);
    if(persons[item.gsx$nombre.$t + " " + item.gsx$apellido.$t]){
      var membership = {
        //"id": idvalue,
        "label": item.gsx$cargonominal.$t,
        "role": item.gsx$cargonominal.$t,
        "type": item.gsx$cargotipo.$t,
        "class": item.gsx$cargoclase.$t,
        "intended_duration": item.gsx$duracioncargo.$t,
        "person_id": persons[item.gsx$nombre.$t + " " + item.gsx$apellido.$t].id,
        "organization_id": organizations[item.gsx$organizacion.$t].id,
        "naming_date": item.gsx$fechanombramiento.$t,
        //"area_id": item.gsx$areaid.$t,
        "party": item.gsx$partido.$t,
        "party_id": item.gsx$partidogeneral.$t,
        "heritage": item.gsx$patrimtotal.$t,
        "heritage_url": item.gsx$patrimurl.$t,
        "notes": item.gsx$observaciones.$t,
        "added_by": item.gsx$agregadopor.$t,
      };
      var startDate = transformDateStr(item.gsx$fechainicio.$t); // || item.gsx$fechainicioyear.$t;
      if (startDate) {
        membership.start_date = startDate;
      }
      var endDate = transformDateStr(item.gsx$fechafin.$t); // || item.gsx$fechafinyear.$t;
      if (endDate) {
        membership.end_date = endDate;
      }
      if (!startDate) {
        if (item.gsx$fechainicioyear.$t) {
          membership.start_date = item.gsx$fechainicioyear.$t + "-12-10";
          membership.start_date_accuracy = "year";
        }
      }
      if (!endDate) {
        if (item.gsx$fechafinyear.$t) {
          membership.end_date = item.gsx$fechafinyear.$t + '-12-10';
          membership.end_date_accuracy = "year";
        }
      }
      //Validate dates
      if (startDate && !dateRe.test(startDate)) {
        console.log('invalid start ', startDate);
      }
      if (endDate && !dateRe.test(endDate)) {
        console.log('invalid end ', endDate);
      }
      //Sources
      if (item.gsx$fuentededatosinicio.$t || item.gsx$urlfuenteinicio.$t) {
        membership.sources = membership.sources || [];
        membership.sources.push({
          data: "start_date",
          source: item.gsx$fuentededatosinicio.$t,
          source_url: item.gsx$urlfuenteinicio.$t,
          quality: item.gsx$calidaddeldatoinicio.$t,
        });
      }
      if (item.gsx$fuentededatosfin.$t || item.gsx$urlfuentefin.$t) {
        membership.sources = membership.sources || [];
        membership.sources.push({
          data: "end_date",
          source: item.gsx$fuentededatosfin.$t,
          source_url: item.gsx$urlfuentefin.$t,
          quality: item.gsx$calidaddeldatofin.$t,
        });
      }
      if (item.gsx$territorio.$t) {
        membership.area = {
          id: item.gsx$territorio.$t + ', ' + item.gsx$territorioextendido.$t,
          name: item.gsx$territorio.$t + ', ' + item.gsx$territorioextendido.$t
        };
      }
      membershipsToPost.push(membership);
      sendMembershipToSINAR(membership).then(
        function(data){
          console.log("Respuesta: ");
          console.log(data);
        }
      );
    }else{
      console.log("PERSON NOT FOUND: " + item.gsx$nombre.$t + " " + item.gsx$apellido.$t);
    }
  });
  var p = JSON.stringify(membershipsToPost);
  fs.writeFileSync('data/memberships-sinar.json', beautify(p, {
    indent_size: 2
  }));
  console.log("Memberships JSON generated!")
  var totalItems = membershipsToPost.length;
  deferred.resolve();
  return deferred.promise;
}

function sinarCheckPeopleOutside() {
  var allPersons = require("./data/persons-sinar.json");
  var deferred = Q.defer();
  var persons = allPersons.reduce(function(memo, person) {
    memo[person.name] = person;
    return memo;
  }, [{}]);
  var personsOutside = [];
  var invalids = 0;
  content.feed.entry.forEach(function(item) {
    //console.log(item.gsx$nombre.$t + " " + item.gsx$apellido.$t);
    if(!persons[item.gsx$nombre.$t + " " + item.gsx$apellido.$t]){
      console.log(item.gsx$nombre.$t + " " + item.gsx$apellido.$t);
      personsOutside.push(item.gsx$nombre.$t + " " + item.gsx$apellido.$t);
    }
  });
  console.log("Persons outside sinar: "+personsOutside.length);
  deferred.resolve();
  return deferred.promise;
}

function sendMembershipToSINAR(membership){
  return Q.promise(function(resolve, reject, notify) {
    var url = config.SinarURL + "memberships";
    var options = {
      url: url,
      method: 'POST',
      body: membership,
      json: true,
      headers: {
        'Authorization': config.SinarApikey
      }
    }
    console.log("sending membership: ");
    console.log(membership);
    request(options, function(err, httpResponse, body) {
      if (err) {
        console.log(err)
        reject(err);
      } else {
        console.log(body);
        resolve(body);
      }
    });
  });
}

function sinarLoadMembershipsFirstPage(num_pages,currentJSON){
  return Q.promise(function(resolve, reject, notify) {
    console.log("Starting loading from SINAR project");
    var options = {
      url: "",
      method: 'GET',
      //json: true,
      headers: {
        'Authorization': config.SinarApikey
      }
    }
    var pageNumber = 1;
    options.url = config.SinarURL + "memberships?page="+pageNumber;
    console.log("SINAR URL is " + options.url);
    request(options, function(err, httpResponse, body) {
      console.log("Se envio request");
      if (err) {
        console.log(err)
        reject(err);
      } else {

        var jsonBody = JSON.parse(body);
        //console.log(jsonBody.num_pages);
        num_pages = jsonBody.num_pages;
        currentJSON = jsonBody.results;
        //console.log(currentJSON);
        var result = {
          "num_pages": num_pages,
          "json": currentJSON
        };
        //console.log("FINISHED FIRST PROMISE");
        resolve(result);
      }
    });
  });
}

function sinarLoadMembershipsByPage(pageNumber,num_pages,sinarMembershipsArray){
  var totArray = sinarMembershipsArray.slice();
  return Q.promise(function(resolve, reject, notify) {
    //console.log("Starting loading from SINAR project");
    var options = {
      url: config.SinarURL + "memberships?page="+pageNumber,
      method: 'GET',
      //json: true,
      headers: {
        'Authorization': config.SinarApikey
      }
    }
    console.log("SINAR URL is " + options.url);
    request(options, function(err, httpResponse, body) {
      //console.log("Se envio request");
      if (err) {
        console.log(err)
        reject(err);
      } else {
        var jsonBody = JSON.parse(body);
        //console.log(jsonBody.num_pages);
        page = jsonBody.page;
        currentJSON = jsonBody.results;
        var result = {
          "page": page,
          "json": currentJSON
        };
        /*for(var _obj in currentJSON){
          sinarPersonsArray.concat(currentJSON[_obj])
        };*/
        //console.log(totArray);
        totArray = totArray.concat(currentJSON);
        if(page<num_pages){
          var nextPage = page + 1;
          sinarLoadMembershipsByPage(nextPage,num_pages,totArray).then(
            function(data){
              //console.log("Finished page: " + data.page);
              resolve(data);
            }
          );
        }else{
          var p = JSON.stringify(totArray);
          fs.writeFileSync('data/memberships-sinar.json', beautify(p, {
            indent_size: 2
          }));
          console.log("LOADED MEMBERSHIPS WITH IDs FROM SINAR: " + totArray.length);
          resolve(result);
        }
      }
    });
  });
}

function sinarLoadMemberships(){
  return Q.promise(function(resolve, reject, notify) {
    var num_pages;
    var finalJSON = [{}];
    sinarLoadMembershipsFirstPage(num_pages,finalJSON).then(
      function(data){
        //console.log(data);
        num_pages = data.num_pages;
        //for(var _obj in currentJSON) sinarPersonsArray.concat(currentJSON[_obj]);
        var sinarMembershipsArray = data.json;
        if(num_pages>1){
          var i = 2;
          sinarLoadMembershipsByPage(i,num_pages,sinarMembershipsArray).then(
            function(data){
              //console.log(sinarPersonsArray);
              /*var p = JSON.stringify(sinarPersonsArray);
              fs.writeFileSync('data/persons-sinar.json', beautify(p, {
                indent_size: 2
              }));*/
              resolve(data);
            }
          );
        }

      }
    );
  });
}

function sinarCreatePeopleWithMembershipsJSON() {
  var allOrganizations = require("./data/organizations-sinar.json");
  var allPersons = require("./data/persons-sinar.json");
  var allMemberships = require("./data/memberships-sinar.json");
  var deferred = Q.defer();
  allPersons.sort(function(a, b){
    return a.id - b.id;
  });
  allOrganizations.sort(function(a, b){
    return a.id - b.id;
  });
  allMemberships.sort(function(a, b){
    return a.person_id - b.person_id;
  });
  var result = [{}];
  for (var key in allPersons) {
    var person = allPersons[key];
    //console.log(person);
    //console.log(person.given_name);
    var personMemberships = allMemberships.filter(function (el) {
        //console.log("value:" + value);
        //console.log(el.person_id);
        return (el.person_id == person.id);
    });
    //console.log(personMemberships.length);
    person.memberships = personMemberships;
    if(!person.name){
      person.name = person.family_name;
    }
    result.push(person);
  }
  var p = JSON.stringify(result);
   fs.writeFileSync('data/personsAndMemberships-sinar.json', beautify(p, {
     indent_size: 2
   }));
   /*fs.writeFileSync(config.JsonCargografiasPath + 'static-public/datasets/cargografias-persons.json', beautify(p, {
      indent_size: 2
    }));*/
   console.log("PersonsWithMemberships from SINAR, JSON generated!")
   deferred.resolve();
   return deferred.promise;

}


//DIRECT JSON LOADER FUNCTIONS:

function runCreateJSONs() {
  Q.fcall(function() {})
    .then(downloadSpreadsheet)
    .then(loadSpreadsheetData)
    .then(CreatePersonsJSON)
    .then(CreateOrganizationsJSON)
    .then(CreateMembershipsJSON)
    .then(CreatePeopleWithMembershipsJSON)
    .catch(function(err) {
      console.log("Something went wrong");
      console.log(err);
      throw err;
    })
    .done();
}

function CreatePersonsJSON() {
  var deferred = Q.defer();
  var personas = {};
  var personasArr = [];
  content.feed.entry.forEach(function(item, ix) {
    try {
      var key = item.gsx$nombre.$t + ' ' + item.gsx$apellido.$t;
      if (!personas[key]) {
        personas[key] = 1; //de-duplicate
        var idvalue = getRandomIdInt(100000000000,999999000000) + ix;
        var persona = {
          name: item.gsx$nombre.$t + ' ' + item.gsx$apellido.$t,
          family_name: item.gsx$apellido.$t,
          given_name: item.gsx$nombre.$t,
          image: item.gsx$urlfoto.$t,
          gender: item.gsx$sexo.$t,
          id: idvalue
        };
        if (item.gsx$nrodedoc.$t) {
          persona.identifiers = [{
            identifier: item.gsx$nrodedoc.$t,
            scheme: item.gsx$documentotipo.$t
          }]
        }
        personasArr.push(persona);
      }
    } catch (ex) {
      console.log("Error importing Person")
      console.log(ex.stack);
    }
  });
  var p = JSON.stringify(personasArr);
  fs.writeFileSync('data/personsFromXLS.json', beautify(p, {
    indent_size: 2
  }));
  deferred.resolve();
  console.log("Persons JSON generated!")
  return deferred.promise;
}

function CreateOrganizationsJSON() {
  var deferred = Q.defer();
  var organizations = {};
  var itemsToPost = [];
  content.feed.entry.forEach(function(item) {
    var key = item.gsx$organizacion.$t
    if (!organizations[key]) {
      organizations[key] = 1;
      var idvalue = getRandomIdInt(100000000000,999999000000);
      itemsToPost.push({
        name: key,
        id: idvalue
      });
    }
  });
  var p = JSON.stringify(itemsToPost);
  fs.writeFileSync('data/organizationsFromXLS.json', beautify(p, {
    indent_size: 2
  }));
  fs.writeFileSync(config.JsonCargografiasPath + 'static-public/datasets/cargografias-organizations.json', beautify(p, {
    indent_size: 2
  }));
  deferred.resolve();
  console.log("Organizations JSON generated!")
  return deferred.promise;
}

function CreateMembershipsJSON() {
  var allOrganizations = require("./data/organizationsFromXLS.json");
  var allPersons = require("./data/personsFromXLS.json");
  var deferred = Q.defer();
  var dateRe = /^[0-9]{4}(-[0-9]{2}){0,2}$/;
  var organizations = allOrganizations.reduce(function(memo, organization) {
    memo[organization.name] = organization;
    return memo;
  }, {});
  var persons = allPersons.reduce(function(memo, person) {
    memo[person.name] = person;
    return memo;
  }, {});
  var membershipsToPost = [];
  var invalids = 0;
  content.feed.entry.forEach(function(item) {
    var idvalue = getRandomIdInt(100000000000,999999000000);
    var membership = {
      "id": idvalue,
      "label": item.gsx$cargonominal.$t,
      "role": item.gsx$cargonominal.$t,
      "type": item.gsx$cargotipo.$t,
      "class": item.gsx$cargoclase.$t,
      "intended_duration": item.gsx$duracioncargo.$t,
      "person_id": persons[item.gsx$nombre.$t + " " + item.gsx$apellido.$t].id,
      "organization_id": organizations[item.gsx$organizacion.$t].id,
      "naming_date": item.gsx$fechanombramiento.$t,
      "area_id": item.gsx$areaid.$t,
      "party": item.gsx$partido.$t,
      "party_id": item.gsx$partidogeneral.$t,
      "heritage": item.gsx$patrimtotal.$t,
      "heritage_url": item.gsx$patrimurl.$t,
      "notes": item.gsx$observaciones.$t,
      "added_by": item.gsx$agregadopor.$t,
    };
    var startDate = transformDateStr(item.gsx$fechainicio.$t); // || item.gsx$fechainicioyear.$t;
    if (startDate) {
      membership.start_date = startDate;
    }
    var endDate = transformDateStr(item.gsx$fechafin.$t); // || item.gsx$fechafinyear.$t;
    if (endDate) {
      membership.end_date = endDate;
    }
    if (!startDate) {
      if (item.gsx$fechainicioyear.$t) {
        membership.start_date = item.gsx$fechainicioyear.$t + "-12-10";
        membership.start_date_accuracy = "year";
      }
    }
    if (!endDate) {
      if (item.gsx$fechafinyear.$t) {
        membership.end_date = item.gsx$fechafinyear.$t + '-12-10';
        membership.end_date_accuracy = "year";
      }
    }
    //Validate dates
    if (startDate && !dateRe.test(startDate)) {
      console.log('invalid start ', startDate);
    }
    if (endDate && !dateRe.test(endDate)) {
      console.log('invalid end ', endDate);
    }
    //Sources
    if (item.gsx$fuentededatosinicio.$t || item.gsx$urlfuenteinicio.$t) {
      membership.sources = membership.sources || [];
      membership.sources.push({
        data: "start_date",
        source: item.gsx$fuentededatosinicio.$t,
        source_url: item.gsx$urlfuenteinicio.$t,
        quality: item.gsx$calidaddeldatoinicio.$t,
      });
    }
    if (item.gsx$fuentededatosfin.$t || item.gsx$urlfuentefin.$t) {
      membership.sources = membership.sources || [];
      membership.sources.push({
        data: "end_date",
        source: item.gsx$fuentededatosfin.$t,
        source_url: item.gsx$urlfuentefin.$t,
        quality: item.gsx$calidaddeldatofin.$t,
      });
    }
    if (item.gsx$territorio.$t) {
      membership.area = {
        id: item.gsx$territorio.$t + ', ' + item.gsx$territorioextendido.$t,
        name: item.gsx$territorio.$t + ', ' + item.gsx$territorioextendido.$t
      };
    }
    membershipsToPost.push(membership);
  });
  var p = JSON.stringify(membershipsToPost);
  fs.writeFileSync('data/membershipsFromXLS.json', beautify(p, {
    indent_size: 2
  }));
  fs.writeFileSync(config.JsonCargografiasPath + 'static-public/datasets/cargografias-memberships.json', beautify(p, {
    indent_size: 2
  }));
  console.log("Memberships JSON generated!")
  var totalItems = membershipsToPost.length;
  deferred.resolve();
  return deferred.promise;
}

function CreatePeopleWithMembershipsJSON() {
  var allOrganizations = require("./data/organizationsFromXLS.json");
  var allPersons = require("./data/personsFromXLS.json");
  var allMemberships = require("./data/membershipsFromXLS.json");
  var deferred = Q.defer();
  allPersons.sort(function(a, b){
    return a.id - b.id;
  });
  allOrganizations.sort(function(a, b){
    return a.id - b.id;
  });
  allMemberships.sort(function(a, b){
    return a.person_id - b.person_id;
  });
  var result = [{}];
  for (var key in allPersons) {
    var person = allPersons[key];
    //console.log(person);
    //console.log(person.given_name);
    var personMemberships = allMemberships.filter(function (el) {
        //console.log("value:" + value);
        //console.log(el.person_id);
        return (el.person_id == person.id);
    });
    //console.log(personMemberships.length);
    person.memberships = personMemberships;
    if(!person.name){
      person.name = person.family_name;
    }
    result.push(person);
  }
  var p = JSON.stringify(result);
   fs.writeFileSync('data/personsAndMembershipsFromXLS.json', beautify(p, {
     indent_size: 2
   }));
   fs.writeFileSync(config.JsonCargografiasPath + 'static-public/datasets/cargografias-persons.json', beautify(p, {
      indent_size: 2
    }));
   console.log("PersonsWithMemberships JSON generated!")
   deferred.resolve();
   return deferred.promise;

}


runProgram(process.argv);
