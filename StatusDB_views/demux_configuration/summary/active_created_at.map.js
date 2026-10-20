function(doc) {
  emit([doc.active, doc.created_at], {
    id: doc._id,
    version: doc.version,
    active: doc.active,
    created_at: doc.created_at,
    created_by: doc.created_by,
    comment: doc.comment
  });
}
