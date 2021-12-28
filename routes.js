const session = require("express-session");
const bcrypt = require("bcrypt");
const ObjectId = require("mongodb").ObjectId;
const h = require("./helper.js");
const fs = require('fs');
const path = require('path');
const saltRounds = 12;

module.exports = function(app, db) {
  app.use(
    session({
      secret: process.env.SECRET_SESSION_KEY,
      resave: true,
      saveUninitialized: true
    })
  );

  app.get("/", function(request, response) {
    if (loggedIn(request.session.user_id)) {
      response.redirect("/profile");
    }
    response.render(`${__dirname}/views/index.ejs`);
  });

  app
    .route("/register")
    .get((req, res) => {
      if (loggedIn(req.session.user_id)) {
        res.redirect("/profile");
      }
      res.sendFile(`${__dirname}/views/register.html`);
    })
    .post((req, res) => {
      if (loggedIn(req.session.user_id)) {
        res.redirect("/profile");
      }

      const email = h.cleanseString(req.body.email);
      const name = h.cleanseString(req.body.name);
      const password = req.body.password;

      callPromise(getUserByEmail(db, "image-app-users", email)).then(function(result) {
        if (result) {
          res.send("email has already been taken");
          return;
        } else {
          bcrypt.genSalt(saltRounds, function(fail, salt) {
            bcrypt.hash(password, salt, function(fail, hash) {
              if (fail) {
                res.send(fail.message);
                return;
              } else {
                const date = new Date();
                db.collection("image-app-users").insertOne(
                  {
                    _id: new ObjectId(),
                    email: email,
                    name: name,
                    password_hash: hash,
                    about: "",
                    admin: false,
                    profileImageURL: "",
                    followedIds: [],
                    followerIds: [],
                    createdAt: date,
                    updatedAt: date
                  },
                  (insert_error, new_el) => {
                    if (insert_error) {
                      res.send(insert_error.message);
                    } else {
                      req.session.user_id = new_el.ops[0]._id;
                      req.session.user_name = new_el.ops[0].name;
                      res.redirect("/profile");
                    }
                  }
                );
              }
            });
          });
        }
      });
    });

  app.post("/login", (req, res) => {
    if (loggedIn(req.session.user_id)) {
      res.redirect("/profile");
    }
    const email = h.cleanseString(req.body.email);
    const password = req.body.password;

    callPromise(getUserByEmail(db, "image-app-users", email)).then(function(result) {
      if (!result) {
        res.send("Email is not registered.");
        return;
      }
      const hash = result.password_hash;
      bcrypt.compare(password, hash, function(fail, outcome) {
        if (fail) {
          res.send(fail.message);
          return;
        } else {
          if (outcome) {
            req.session.user_id = result._id;
            req.session.user_name = result.name;
            back(req, res)
          } else {
            res.send("Wrong password.");
          }
        }
      });
    });
  });

  app.get("/logout", (req, res) => {
    req.session.user_id = undefined;
    back(req, res)
  });

  app.get("/profile", (req, res) => {
    const id = req.session.user_id;
    if (!loggedIn(id)) {
      res.redirect("/");
    }
    
    session.currentURL = "/profile"

    callPromise(getUserById(db, "image-app-users", id)).then(function(user) {
      callPromise(getPostsOfUser(db, "image-app-posts", user._id.toString())).then(function(posts) {
        callPromise(getLikedPostsByUser(db, "image-app-posts", user._id.toString())).then(function(likedPosts) {
          getCreatorPerPostThenRender(renderWithData, res, "profile.ejs", 
                                      { user: user, 
                                        posts: posts, 
                                        viewerId: user._id.toString() }, 
                                      likedPosts, 0, [])
        });
      });
    });
  });
  
  app.post("/addProfileImage", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    const imageURL = h.cleanseString(req.body.imageURL)
    
    db.collection("image-app-users").updateOne({ _id: ObjectId(req.session.user_id) }, 
                                               { $set: { profileImageURL: imageURL } })
    
    res.redirect("/profile")
  })
  
  app.post("/changeProfileImage", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    db.collection("image-app-users").updateOne({ _id: ObjectId(req.session.user_id) }, 
                                               { $set: { profileImageURL: "" } })
    
    res.redirect("/profile")
  })
  
  app.post("/addProfileDescription", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    const about = h.cleanseString(req.body.about)
    
    db.collection("image-app-users").updateOne({ _id: ObjectId(req.session.user_id) }, 
                                               { $set: { about: about } })
    
    res.redirect("/profile")
  })
  
  app.get("/changeProfileDescription", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    db.collection("image-app-users").updateOne({ _id: ObjectId(req.session.user_id) }, 
                                               { $set: { about: "" } })
    
    res.redirect("/profile")
  })

  app.get("/post", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    const id = req.session.user_id
    
    callPromise(getUserById(db, "image-app-users", id)).then(function(result) {
      renderWithData(res, "post.ejs", { user: result, viewerId: result._id.toString() });
    });
  });

  app.post("/post", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    const userId = req.session.user_id
    const title = req.body.title
    const imageURL = req.body.imageURL
    const context = req.body.context

    callPromise(createPost(db, "image-app-posts", userId, title, imageURL, context)).then(function(result) {
      const path = "/show-post/" + result._id
      res.redirect(path)
    });
  });

  app.get("/delete-post/:id", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    if (req.session.currentURL == `/post/${req.params.id}`) {
      req.session.currentURL = "/new-posts"
    } 
    
    callPromise(isAdmin(db, "image-app-users", req.session.user_id)).then(function(admin) {
      if(admin) {
        callPromise(deletePost(db, "image-app-posts", req.params.id)).then(function(post) {
            back(req, res)  
        })
      } else {
        callPromise(isCreator(db, "image-app-posts", req.params.id, req.session.user_id)).then(function(creator) {
          if(creator) {
            callPromise(deletePost(db, "image-app-posts", req.params.id)).then(function(post) {
              back(req, res)
            })
          } else {
            res.redirect("/")
          }
        })
      }
    })
  });
  
  app.post("/like-post/:postId", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    const postId = req.params.postId
    const userId = req.session.user_id
    
    callPromise(likePost(db, "image-app-posts", postId, userId)).then(function(result) {
      res.json(result)
    }).catch(function(error){
      res.json(error.message)
    });
  });
  
  app.post("/regret-like-post/:postId", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    const postId = req.params.postId
    const userId = req.session.user_id
    
    callPromise(regretLikePost(db, "image-app-posts", postId, userId)).then(function(result) {
      res.json(result)
    }).catch(function(error){
      res.json(error.message)
    });
  });
  
  app.get("/show-post/:id", (req, res) => {
    const postId = req.params.id
    req.session.currentURL = `/show-post/${postId}`
    
    callPromise(getPostById(db, "image-app-posts", postId)).then(function(post) {
      if(post){
        callPromise(getUserById(db, "image-app-users", post.creatorId)).then(function(creator) {
          let data = [{post: post, creator: creator}]
          renderWithData(res, "showPosts.ejs", { data: data, viewerId: req.session.user_id });
        });
      } else {
        res.send("/no data available")
      }
    });
  });
  

  app.get("/new-posts", (req, res) => {
    let date = new Date();
    date.setHours(date.getHours()-1)
    const viewerId = req.session.user_id ? req.session.user_id : null
    req.session.currentURL = "/new-posts"
  
    callPromise(getPostsByDate(db, "image-app-posts", date)).then(function(posts) {
      if(posts){
        var data = []
        getCreatorPerPostThenRender(renderWithData, res, "showPosts.ejs", 
                                    { viewerId: req.session.user_id }, posts, 0, data)
      } else {
        res.send("/no data available")
      }
    });
  });

  app.get("/top-posts", (req, res) => {
    const date = req.query.date ? req.query.date : new Date("01 Jan 2021")
    req.session.currentURL = "/top-posts"
    
    callPromise(getTopLikedPosts(db, "image-app-posts", date)).then(function(posts) {
      if(posts){
        var data = []
        getCreatorPerPostThenRender(renderWithData, res, "showPosts.ejs", 
                                    { viewerId: req.session.user_id }, posts, 0, data)
      } else {
        res.send("/no data available")
      }
    });
  });
  
  app.post("/comment/:type/:parentId", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    const content = h.cleanseString(req.body.content)
    const type = req.params.type
    const parentId = req.params.parentId
    const userId = req.session.user_id
    
    callPromise(createComment(db, "image-app-comments", content, type, parentId, userId)).then(function(result) {
      if(result){
        if(req.session.currentURL){
          back(req, res)
        } else {
          res.redirect(`/show-${type}/${parentId}`)
        }
      } else {
        res.send("failed to post comment.")
      }
    });
  })
  
  app.get("/delete-comment/:commentId", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    const commentId = req.params.commentId
    const userId = req.session.user_ıd
    
    callPromise(isAdmin(db, "image-app-users", userId)).then(function(admin) {
      if(admin){
        callPromise(deleteComment(db, "image-app-comments", commentId)).then(function(result) {
          back(req, res)
        });
      } else {
        callPromise(isCommentor(db, "image-app-comments", commentId, userId)).then(function(commentor) {
          if(commentor){
            callPromise(deleteComment(db, "image-app-comments", commentId)).then(function(result) {
              back(req, res)
            });
          } else {
            res.redirect("/")
          }
        })
      }
    })
  })
  
  app.post("/like-comment/:commentId", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    const commentId = req.params.commentId
    const userId = req.session.user_id
    
    callPromise(likeComment(db, "image-app-comments", commentId, userId)).then(function(result) {
      res.json(result)
    });
  });
  
  app.post("/regret-like-comment/:commentId", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    const commentId = req.params.commentId
    const userId = req.session.user_id
    
    callPromise(regretLikeComment(db, "image-app-comments", commentId, userId)).then(function(result) {
      res.json(result)
    });
  });
  
  app.post("/follow/:followedId", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    const followerId = req.session.user_id
    const followedId = req.params.followedId
    
    callPromise(followUser(db, "image-app-users", followerId, followedId)).then(function(result) {
      if(result){
        callPromise(getUserById(db, "image-app-users", followedId)).then(function(followedUser) {
          res.json(followedUser)
        })
      } else {
        res.send(false)
      }
    });
  })
  
  app.post("/unfollow/:followedId", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    const followerId = req.session.user_id
    const followedId = req.params.followedId
    
    callPromise(unfollowUser(db, "image-app-users", followerId, followedId)).then(function(result) {
      if(result){
        callPromise(getUserById(db, "image-app-users", followedId)).then(function(followedUser) {
          res.json(followedUser)
        })
      } else {
        res.send(false)
      }
    });
  })
  
  app.get("/feed", (req, res) => {
    if (!loggedIn(req.session.user_id)) {
      res.redirect("/");
    }
    
    const userId = req.session.user_id
    
    callPromise(getUserFeed(db, "image-app-users", userId)).then(function(feedPosts) {
      if(feedPosts){
        res.json(feedPosts)
      } else {
        res.send(false)
      }
    });
  })
  
  
  app.get("/getUserJSON/:id", (req, res) => {
    getUserById(db, "image-app-users", ObjectId(req.params.id)).then(function(user) {
      if(user){
        res.json({ creatorId: user._id.toString(),
                   viewerId: req.session.user_id,
                   name: user.name,
                   about: user.about,
                   image: user.profileImageURL,
                   followerIds: user.followerIds })
      } else {
        res.send(false)
      }
    })
  })
  

  /*                                     helper methods depends on app and db added here                                    */

  //call async data request from database (promise -> data request, example: getUserById function)
  const callPromise = async promise => {
    const result = await promise;
    return result;
  };

  //call getUserById as shown beneath
  /* 
    callPromise(getUserById(db, "image-app-users", id)).then(function(result) {
      use received data here...
    });
  */

  const getUserById = (db, cluster, id) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster).findOne({ _id: ObjectId(id) }, (error, result) => {
        if (error) {
          reject(error);
        } else if (result) {
          resolve(result);
        } else {
          resolve(false);
        }
      });
    });
  };
  
  //call getUserByIds as shown beneath
  /* 
    callPromise(getUserByIds(db, "image-app-users", ids)).then(function(result) {
      use received data here...
    });
  */

  const getUserByIds = (db, cluster, ids) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster).find({ _id: { $in: ids } }).toArray((error, result) => {
        if(error) {
          reject(error)
        } else if(result) {
          resolve(result)
        } else {
          resolve(false)
        }
      });
    });
  };

  //call getUserByEmail as shown beneath
  /* 
    callPromise(getUserByEmail(db, "image-app-users", email)).then(function(result) {
      use received data here...
    });
  */

  const getUserByEmail = (db, cluster, email) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster).findOne({ email: email }, (error, result) => {
        if (error) {
          reject(error);
        } else if (result) {
          resolve(result);
        } else {
          resolve(false);
        }
      });
    });
  };

  //call createPost as shown beneath
  /* 
    callPromise(createPost(db, "image-app-posts", userId, title, imageURL, context)).then(function(result) {
      use received data here...
    });
  */

  const createPost = (db, cluster, userId, title, imageURL, context, tags) => {
    return new Promise((resolve, reject) => {
      const date = new Date();
      db.collection(cluster).insertOne(
        {
          _id: new ObjectId(),
          creatorId: userId,
          title: title,
          imageURL: imageURL,
          context: context,
          tags: tags,
          likedUserIds: [],
          commentIds: [],
          createdAt: date,
          updatedAt: date
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result.ops[0]);
          }
        }
      );
    });
  };

  //call getPostById as shown beneath
  /* 
    callPromise(getPostById(db, "image-app-posts", postId)).then(function(result) {
      use received data here...
    });
  */

  const getPostById = (db, cluster, postId) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster).findOne(
        { _id: ObjectId(postId) },
        (error, result) => {
          if (error) {
            reject(error);
          } else if (result) {
            resolve(result);
          } else {
            resolve(false);
          }
        }
      );
    });
  };
  
  //call getPostsByTags as shown beneath
  /* 
    callPromise(getPostsByTags(db, "image-app-posts", tags)).then(function(result) {
      use received data here...
    });
  */
  
  const getPostsByTags = (db, cluster, tags) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster).find( { tags: tags })
                            .sort({ createdAt: -1 })
                            .toArray((error, result) => {
        if(error) {
          reject(error)
        } else if(result) {
          resolve(result)
        } else {
          resolve(false)
        }
      })
    })
  }

  //call deletePost as shown beneath
  /* 
    callPromise(deletePost(db, "image-app-posts", postId)).then(function(result) {
      use received data here...
    });
  */

  const deletePost = (db, cluster, postId) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster).deleteOne(
        { _id: ObjectId(postId) },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(true);
          }
        }
      );
    });
  };


  //call likePost as shown beneath
  /* 
    callPromise(likePost(db, "image-app-posts", postId, userId)).then(function(result) {
      use received data here...
    });
  */

  const likePost = (db, cluster, postId, userId) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster).findOneAndUpdate(
        { _id: ObjectId(postId), likedUserIds: { $ne: userId }, creatorId: { $ne: userId } },
        { $push: { likedUserIds: userId } },
        { returnOriginal: false },
        (error, result) => {
          if (error) {
            reject(error);
          } else if (result) {
            resolve(result)
          } else {
            resolve(false)
          }
        }
      );
    });
  };
  
  //call regretLikePost as shown beneath
  /* 
    callPromise(regretLikePost(db, "image-app-posts", postId, userId)).then(function(result) {
      use received data here...
    });
  */

  const regretLikePost = (db, cluster, postId, userId) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster).findOneAndUpdate(
        { _id: ObjectId(postId), likedUserIds: userId },
        { $pull: { likedUserIds: userId } },
        { returnOriginal: false },
        (error, result) => {
          if (error) {
            reject(error);
          } else if (result) {
            resolve(result);
          } else {
            resolve(false)
          }
        }
      );
    });
  };

  //call getLikedPostsByUser as shown beneath
  /* 
    callPromise(getLikedPostsByUser(db, "image-app-posts", userId)).then(function(result) {
      use received data here...
    });
  */

  const getLikedPostsByUser = (db, cluster, userId) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster)
        .find({ likedUserIds: userId })
        .sort({ createdAt: -1 })
        .toArray((error, result) => {
          if (error) {
            reject(error);
          } else if (result) {
            resolve(result);
          } else {
            resolve(false);
          }
        });
    });
  };

  //call isCreator as shown beneath
  /* 
    callPromise(isCreator(db, "image-app-posts", postId, userId)).then(function(result) {
      use received data here...
    });
  */

  const isCreator = (db, cluster, postId, userId) => {
    return new Promise((resolve, reject) => {
      callPromise(getPostById(db, cluster, postId)).then(function(result) {
        if (result) {
          if (result.creatorId == userId) {
            resolve(true);
          } else {
            resolve(false);
          }
        } else {
          resolve(false);
        }
      });
    });
  };

  //call getPostsOfUser as shown beneath
  /* 
    callPromise(getPostsOfUser(db, "image-app-posts", userId, dateFilter, false)).then(function(result) {
      use received data here...
    });
  */

  const getPostsOfUser = (db, cluster, userId, dateFilter = false, multipleUsers = false) => {
    return new Promise((resolve, reject) => {
      var query = multipleUsers
        ? { creatorId: { $in: userId } } 
        : { creatorId: userId };
      
      if(dateFilter){
        query.createdAt =  { $gte: dateFilter }
      }
      
      db.collection(cluster)
        .find(query)
        .sort({ createdAt: -1 })
        .toArray((error, resultArray) => {
          if (error) {
            reject(error);
          } else if (resultArray) {
            resolve(resultArray);
          } else {
            resolve(false);
          }
        });
    });
  };
  
  //call getPostsByDate as shown beneath
  /* 
    callPromise(getPostsByDate(db, "image-app-posts", date)).then(function(result) {
      use received data here...
    });
  */
  
  const getPostsByDate = (db, cluster, date) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster)
        .find({ createdAt: { $gte: date } })
        .sort({ createdAt: -1 })
        .toArray((error, result) => {
          if(error) {
            reject(error)
          } else if (result) {
            resolve(result)
          } else {
            resolve(false)
          }
        })
    })
  }
  
  //call getTopLikedPosts as shown beneath
  /* 
    callPromise(getPostsOfUser(db, "image-app-posts", dateFilter)).then(function(result) {
      use received data here...
    });
  */
  
  const getTopLikedPosts = (db, cluster, dateFilter) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster)
        .find({ createdAt: { $gte: dateFilter } })
        .toArray((error, result) => {
          if(error) {
            reject(error)
          } else if(result) {
            const posts = result.sort((a, b) => { b.likedUserIds.length - a.likedUserIds.length })
            resolve(posts)
          } else {
            resolve(false)
          }
        })
    })
  }
  
  //call getCreatorPerPostThenRender as shown beneath
  /* 
    getCreatorPerPostThenRender(renderWithData, res, "page.ejs", { renderWithData: argsToPage }, posts, index, data)
  */
  
  const getCreatorPerPostThenRender = (renderCall, response, renderView, renderOpts, posts, index, data) => {
    if(posts[index]){
      callPromise(getUserById(db, "image-app-users", posts[index].creatorId)).then(function(creator){
        data.push({ post: posts[index], creator: creator })
        getCreatorPerPostThenRender(renderCall, response, renderView, renderOpts, posts, ++index, data)
      })
    } else {
      renderOpts.data = data
      renderCall(response, renderView, renderOpts)
    }
  }
  

  //call isAdmin as shown beneath
  /* 
    callPromise(isAdmin(db, "image-app-users", userId)).then(function(result) {
      use received data here...
    });
  */

  const isAdmin = (db, cluster, userId) => {
    return new Promise((resolve, reject) => {
      callPromise(getUserById(db, cluster, userId)).then(function(result) {
        if (result) {
          resolve(result.admin);
        } else {
          resolve(false);
        }
      });
    });
  };

  //call followUser as shown beneath
  /* 
    callPromise(followUser(db, "image-app-users", followerId, followedId)).then(function(result) {
      use received data here...
    });
  */

  const followUser = (db, cluster, followerId, followedId) => {
    if(followerId == followedId) return 
    
    return new Promise((resolve, reject) => {
      db.collection(cluster).findOneAndUpdate({ _id: ObjectId(followerId), 
                                                   followedIds: { $ne: followedId} },
                                                 { $push: { followedIds: followedId } }, 
                                                 { returnOriginal: false },
                                                 (error, result) => {
        if(error){
          reject(error)
        } else if(result){
          db.collection(cluster).findOneAndUpdate({ _id: ObjectId(followedId), 
                                                    followerIds: { $ne: followerId} },
                                                 { $push: { followerIds: followerId } },
                                                 { returnOriginal: false },
                                                 (error2, result2) => {
            if(error2 || !result2){
              db.collection(cluster).findOneAndUpdate({ _id: ObjectId(followerId), 
                                                        followedIds: followedId },
                                                      { $pull: { followerIds: followerId } },
                                                      (error3, result3) => {
                if(error2){
                  reject(error2)
                } else if(error3){
                  reject(error3)
                } else {
                  resolve(false)
                }
              })
            } else {
              resolve(result2)
            }
          })
        } else {
          resolve(false)
        }
      })
    });
  };

  //call unfollowUser as shown beneath
  /* 
    callPromise(unfollowUser(db, "image-app-users", followerId, followedId)).then(function(result) {
      use received data here...
    });
  */

  const unfollowUser = (db, cluster, followerId, followedId) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster).findOneAndUpdate({ _id: ObjectId(followerId), followedIds: followedId }, 
                                              { $pull: { followedIds: followedId } },
                                              { returnOriginal: false },
                                              (error, result) => {
        if(error) {
          reject(error)
        } else {
          db.collection(cluster).findOneAndUpdate({ _id: ObjectId(followedId), followerIds: followerId }, 
                                                  { $pull: { followerIds: followerId } }, 
                                                  { returnOriginal: false },
                                                  (error2, result2) => {
            if(error2){
              reject(error2)
            } else if(result2){
              resolve(result2)
            } else {
              resolve(false)
            }
          })
        }
      })
    });
  };

  //call getFollowedUsers as shown beneath
  /* 
    callPromise(getFollowedUsers(db, "image-app-users", userId)).then(function(result) {
      use received data here...
    });
  */

  const getFollowedUsers = (db, cluster, userId) => {
    return new Promise((resolve, reject) => {
      callPromise(getUserById(db, cluster, userId)).then(function(user) {
        if(user){
          callPromise(getUserByIds(db, cluster, user.followedIds.map((i) => ObjectId(i))).then(function(followedUsers){
            if(followedUsers){
              resolve(followedUsers)
            } else {
              resolve(false)
            }
          }))
        } else {
          resolve(false)
        }
      });
    });
  };
  
  //call getUserFeed as shown beneath
  /* 
    callPromise(getUserFeed(db, "image-app-users", userId)).then(function(result) {
      use received data here...
    });
  */

  const getUserFeed = (db, cluster, userId) => {
    return new Promise((resolve, reject) => {
      callPromise(getFollowedUsers(db, "image-app-users", userId)).then(function(users) {
        if(users){
          let date = new Date();
          date = date.setHour(date.getHour()-6)
          
          const userIds = users.map((u) => u.creatorId)
          
          callPromise(getPostsOfUser(db, "image-app-posts", userIds, date, true)).then(function(posts) {
            if(posts){
              resolve(posts)
            } else {
              resolve(false)
            }
          });
        } else {
          resolve(false)
        }
      });
    });
  };
  
  //call createComment as shown beneath
  /* 
    callPromise(createComment(db, "image-app-comments", content, type, parentId, userId)).then(function(result) {
      use received data here...
    });
  */
  
  const createComment = (db, cluster, content, type, parentId, userId) => {
    return new Promise((resolve, reject) => {
      const date = new Date()
      
      db.collection(cluster)
        .insertOne({ _id: new ObjectId(),
                     content: content,
                     createdAt: date,
                     updatedAt: date,
                     type: type,
                     parentId: parentId,
                     userId: userId,
                     commentIds: [],
                     likedUserIds: [] }, (error, result) => {
                       if(error) {
                         reject(error)
                       } else if(result) {
                         resolve(result.ops[0])
                       } else {
                         resolve(false)
                       }
                     })
    })
  }
  
  //call deleteComment as shown beneath
  /* 
    callPromise(deleteComment(db, "image-app-comments", commentId)).then(function(result) {
      use received data here...
    });
  */
  
  const deleteComment = (db, cluster, commentId) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster)
        .deleteOne({ _id: ObjectId(commentId) }, (error, result) => {
          if(error){
            reject(error)
          } else {
            resolve(true)
          }
        })
    })
  }
  
  //call getCommentById as shown beneath
  /* 
    callPromise(getCommentById(db, "image-app-comments", commentId)).then(function(result) {
      use received data here...
    });
  */
  
  const getCommentById = (db, cluster, commentId) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster).findOne({ _id: commentId }, (error, result) => {
        if(error) {
          reject(error)
        } else if(result) {
          resolve(result)
        } else {
          resolve(false)
        }
      })
    })
  }
  
  //call isCommentor
  /* 
    callPromise(isCommentor(db, "image-app-comments", commentId, userId)).then(function(result) {
      use received data here...
    });
  */
  
  const isCommentor = (db, cluster, commentId, userId) => {
    return new Promise((resolve, reject) => {
      callPromise(getCommentById(db, cluster, commentId)).then(function(comment) {
        if(comment){
          if(userId == comment.userId) {
            resolve(true)
          } else {
            resolve(false)
          }
        } else {
          resolve(false)
        }
      })
    })
  }
  
  //call getCommentsByIds as shown beneath
  /* 
    callPromise(getCommentsByIds(db, "image-app-comments", commentIds)).then(function(result) {
      use received data here...
    });
  */
  
  const getCommentsByIds = (db, cluster, commentIds) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster)
        .find({ _id: { $in: commentIds } })
        .sort( { createdAt: -1 } )
        .toArray((error, result) => {
          if(error) {
            reject(error)
          } else if(result) {
            resolve(result)
          } else {
            resolve(false)
          }
        })
    })
  }
  
  //call getCommentsOfParents as shown beneath
  /* 
    callPromise(getCommentsOfPost(db, `image-app-${type}s`, parentId)).then(function(result) {
      use received data here...
    });
  */
  
  const getCommentsOfParents = (db, cluster, parentId) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster)
        .find({ parentId: parentId })
        .sort({ createdAt: -1 })
        .toArray((error, result) => {
          if(error) {
            reject(error)
          } else if(result) {
            resolve(result)
          } else {
            resolve(false)
          }
        })
    })
  }
  
  //call getCommentsOfUser as shown beneath
  /* 
    callPromise(getCommentsOfUser(db, "image-app-comments", userId)).then(function(result) {
      use received data here...
    });
  */
  
  const getCommentsOfUser = (db, cluster, userId) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster)
        .find({ userId: userId })
        .sort({ createdAt: -1 })
        .toArray((error, result) => {
          if(error) {
            reject(error)
          } else if(result) {
            resolve(result)
          } else {
            resolve(false)
          }
        })
    })
  }
  
   //call likeComment as shown beneath
  /* 
    callPromise(likeComment(db, "image-app-comments", commentId, userId)).then(function(result) {
      use received data here...
    });
  */

  const likeComment = (db, cluster, commentId, userId) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster).findOneAndUpdate(
        { _id: ObjectId(commentId), $in: { likedUserIds: userId} },
        { likedUserIds: { $push: userId } },
        { returnOriginal: false },
        (error, result) => {
          if (error) {
            reject(error);
          } else if (result) {
            resolve(result);
          } else {
            resolve(false)
          }
        }
      );
    });
  };
  
  //call regretLikeComment as shown beneath
  /* 
    callPromise(regretLikeComment(db, "image-app-comments", commentId, userId)).then(function(result) {
      use received data here...
    });
  */

  const regretLikeComment = (db, cluster, commentId, userId) => {
    return new Promise((resolve, reject) => {
      db.collection(cluster).findOneAndUpdate(
        { _id: ObjectId(commentId), $in: { likedUserIds: userId} },
        { likedUserIds: { $push: userId } },
        { returnOriginal: false },
        (error, result) => {
          if (error) {
            reject(error);
          } else if (result) {
            resolve(result);
          } else {
            resolve(false)
          }
        }
      );
    });
  };


  const renderWithData = (
    res,
    viewFile,
    obj
  ) /*(response, "profile.ejs", { variableName: dataToRender })*/ => {
    res.render(`${__dirname}/views/${viewFile}`, obj);
  };

  const loggedIn = id => {
    if (typeof id === "undefined") {
      return false;
    }

    return true;
  };

  const back = (req, res) => {
    req.session.currentURL = req.session.currentURL ? req.session.currentURL : "/"
    res.redirect(req.session.currentURL)
  };
  /*                                     helper methods depends on app and db added here                                    */
};
