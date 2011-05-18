/*   
   Copyright 2011 Google Inc

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

var http = require('http');
var async = require('async');
var proxies = require('../../proxies');
var exceptions = require('../../exceptions');
var model = require('../../model');

var Cache = function(timeout) {
  var cache = {};
  var cacheCallback = {};
  var timeout = timeout;

  var clearCacheItem = function(key) {
    delete cache[key];
    delete cacheCallback[key]
  };

  this.add = function(key, value, itemTimeout) {
    timeout = itemTimeout || timeout;
    if(cacheCallback[key]) clearTimeout(cacheCallback[key]);
    cache[key] = value;
    cacheCallback[key] = setTimeout(function() { clearCacheItem(key); }, timeout * 1000);
  };

  this.get = function(key) {
    var result = cache[key];
    return result; 
  };
};

var httpCache = new Cache(60 * 5);

var GoogleFeedProxy = function(configuration) {
  if(!!configuration.options.proxies.googlefeed.apiKey == false) throw "An API Key is required to use the Google Feed API. Please visit http://code.google.com/apis/loader/signup.html"; 
  if(!!configuration.options.proxies.googlefeed.referer == false) throw "A HTTP Referer needs to be set use the Google Feed API.  Check your configuration file"; 
  
  var options = configuration.options.proxies.googlefeed;
  var apiKey = options.apiKey;
  var referer = options.referer;
  var domain = "ajax.googleapis.com";
  var path = "/ajax/services/feed/load";

  this.configuration = configuration;
  var self = this;
  
  var fetchResults = function(res, callback) {
    var data = "";
    res.setEncoding('utf-8');
    res.on('data', function(chunk) {
      data += chunk;
    });

    res.on('end', function() {
      var output = {};

      try {
        output = JSON.parse(data);
      } catch(ex) {
        console.log("error parsing data - maybe remote API is throttling or down?", ex,  data);
      }

      callback(output);
    });
  };

  var toQueryString = function(opts) {
    var qs = []; 
   
    for(var q in opts) {
      qs.push(encodeURIComponent(q) + "=" + opts[q]);
    }
    return qs.join("&");
  };

  var makeRequest = function(options, callback) {
    var path = options.path;
    var item = httpCache.get(path);
    if(item) {
      callback(item);
      return;
    }
    else {
     http.get(options, function(res) {
       fetchResults(res, function(data) {
         httpCache.add(path, data);
         callback(data);
       });
     }); 
    }
  };
 
  this._fetchCategories = function(categories, callback) {
    if(!!callback == false) throw new exceptions.NoCallbackException();

    var qs = {
      v: "1.0",
      q: ""
    };

    var params = {
      path: path + "?" + toQueryString(qs) ,
      host: domain, 
      port: 80
    };

    makeRequest(params, callback);
  };

  this._fetchCategory = function(id, callback) {
    if(!!callback == false) throw new exceptions.NoCallbackException();

    var qs = {
      v: "1.0",
      q: id 
    };

    var params = {
      path: path + "?" + toQueryString(qs),
      host: domain,
      port: 80
    };

    makeRequest(params, callback);
  };

  this._fetchArticle = function(id, category, callback) {
    if(!!callback == false) throw new exceptions.NoCallbackException();
    
    var params = {
      path: path,
      host: domain,
      port: 80
    }
     
    makeRequest(params, callback);
  };

  var parseResults = function(results, output, id) {
    var result, articles, article;
    for(var r = 0; result = results[r]; r++) {
      // We have a list of articles
      articles = result.responseData.feed.entries; 
      for(var a = 0; article = articles[a]; a++) {
        var item = new model.CategoryItem(
          article.link,
          article.title,
          article.contentSnippet,
          output[r]
        );
        item.author = result.author; 
        item.thumbnail = "";
        item.largeImage = "";
        item.url = article.link;
        item.pubDate = new Date(article.publishedDate);
       
        console.log(id, item.id); 
        if(id == item.id) {
          item.body = article.content; 
        }

        if(!!item.thumbnail == false) {
          item.imageState = "textonly";
        }

        output[r].addItem(item);
      }
    }

    return output;
  };

  this._buildCategories = function(categories, id) {
    return function(callback) {
      var output = [];
      // For each category (RSS feed), fetch
      var category;
      var tasks = [];

      for(var i = 0; category = categories[i]; i++) {
        output.push( new model.CategoryData(category.id, category.title));
        tasks.push(self._buildCategory(category.id));
      }

      async.series(
        tasks,
        function (err, results) {
          parseResults(results, output, id);
          callback(null, output);
        }
      );
    };
  };

  this._buildCategory = function(category) {
    return function(callback) {
      self._fetchCategory(category, function(data) {
        callback(null, data); 
      });
    }; 
  };

  this._buildCategoryFromCategories = function(cateogry) {
    return function(results, callback) {
      // We already have the category data, so just mark it up.
      var currentCategory;
      for(var c = 0; currentCategory = results[c]; c++) {
        if(currentCategory.id == category) {
          curentCategory.categoryState = "active";
        }
      } 
      callback(null, results);
    };
  };

  this._buildArticle = function(category, article) {
    return function(categoryData, callback) {
      this._fetchArticle(category, article, function(data) {
        var currentCategory;
        var articles;

        // Update the article in the data structure.
        for(var c = 0; currentCategory = results[c]; c++) {
          if(currentCategory.id == category) {
            curentCategory.categoryState = "active";
            articles = currentCategory.articles;
            for(var a = 0; article = articles[a]; a++) {
              article.articleState = "active";
              article.body = data.content;
            }
          }
        } 
        callback(null, categoryData); 
      });
    }; 
  };

};

GoogleFeedProxy.prototype = new proxies.Proxy();
GoogleFeedProxy.prototype.constructor = proxies.GoogleFeedProxy;

GoogleFeedProxy.prototype.fetchCategories = function(callback) {
  if(!!callback == false) throw new exceptions.NoCallbackException();
  var self = this;

  async.waterfall([
      self._buildCategories(self.configuration.categories)
    ],
    function(err, result) {
      callback(result);
    }
  );
};

GoogleFeedProxy.prototype.fetchCategory = function(id, callback) {
  if(!!callback == false) throw new exceptions.NoCallbackException();
  var self = this;
  
  async.waterfall([
      self._buildCategories(self.configuration.categories),
      self._buildCategoryFromCategories(id)
    ],
    function(err, result) {
      callback(result);
    } 
  );
};

GoogleFeedProxy.prototype.fetchArticle = function(id, currentCategory, callback) {
  if(!!callback == false) throw new exceptions.NoCallbackException();
  var self = this;
  console.log(id, currentCategory);
  async.waterfall([
    // Fetch Categories
    self._buildCategories(self.configuration.categories, id),
    // Fetch Category
    self._buildCategoryFromCategories(currentCategory),
    // Fetch Article
    self._buildArticle()
   ],
   function(err, result) {
     callback(result);
   } 
  );
};

exports.proxy = GoogleFeedProxy;